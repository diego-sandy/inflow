// Pure functions: raw Voyager normalized+json → typed Invitation records.
// Ported from main's network-normalizer (received-invitations slice), kept
// self-contained. Defensive by design — these endpoints are undocumented and
// their shapes drift.
import { pickArtifact } from '@/lib/voyager-image';
import type { Invitation, InvitationInsight } from '@/types/network';
import type { Profile } from '@/types/profile';

function included(raw: any): any[] {
  return Array.isArray(raw?.included) ? raw.included : [];
}

function indexByUrn(entities: any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const e of entities) {
    if (e?.entityUrn) m.set(String(e.entityUrn), e);
  }
  return m;
}

type Resolve = (urn: string) => any;

/** Read a normalized-JSON reference key, tolerating both `*foo` and `foo`. */
function ref(entity: any, key: string): string {
  const v = entity?.[`*${key}`] ?? entity?.[key];
  return typeof v === 'string' ? v : '';
}

function vectorImageFrom(picture: any, resolve?: Resolve): any {
  const p = typeof picture === 'string' ? resolve?.(picture) : picture;
  if (!p || typeof p !== 'object') return null;
  const vi =
    p.displayImageReferenceResolutionResult?.vectorImage ??
    p.displayImageReference?.vectorImage ??
    p['com.linkedin.common.VectorImage'] ??
    p.vectorImage;
  if (vi) return vi;
  const pointer = p['*displayImageReference'];
  if (typeof pointer === 'string' && resolve) {
    const target = resolve(pointer);
    if (target) return vectorImageFrom(target, resolve);
  }
  return Array.isArray(p.artifacts) && p.rootUrl ? p : null;
}

function pictureFrom(picture: any, size = 200, resolve?: Resolve): string {
  const vi = vectorImageFrom(picture, resolve);
  if (vi?.rootUrl && Array.isArray(vi.artifacts) && vi.artifacts.length) {
    const artifact = pickArtifact(vi.artifacts, size);
    if (artifact?.fileIdentifyingUrlPathSegment) {
      return `${vi.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }
  return '';
}

function profilePictureUrl(p: any, size: number, resolve: Resolve): string {
  const candidates = [
    p?.picture,
    p?.['*picture'],
    p?.profilePicture,
    p?.['*profilePicture'],
    p?.profilePicture?.displayImage,
    p?.profilePicture?.['*displayImage'],
  ];
  for (const c of candidates) {
    if (!c) continue;
    const url = pictureFrom(c, size, resolve);
    if (url) return url;
  }
  return '';
}

/** urn:li:fs_miniProfile:X / urn:li:fsd_profile:X / urn:li:member:X → urn:li:fsd_profile:X */
function toFsdProfileUrn(urn: string): string {
  const match = String(urn || '').match(/(?:fs_miniProfile|fsd_profile|member):([^,:)]+)/);
  return match ? `urn:li:fsd_profile:${match[1]}` : '';
}

function displayName(p: any): string {
  return `${p?.firstName || ''} ${p?.lastName || ''}`.trim();
}

/** The shared-connections insight ("X and N others"), hanging off the InvitationView. */
function insightFrom(view: any, resolve: Resolve): InvitationInsight {
  const none: InvitationInsight = { mutualCount: 0, mutualNames: [], mutualPictures: [] };
  const insights = Array.isArray(view?.insights) ? view.insights : [];
  const shared = insights.map((i: any) => i?.sharedInsight ?? i?.sharedConnectionsInsight).find(Boolean);
  if (!shared) return none;

  const refs = shared['*connections'] ?? shared.connections ?? [];
  const profiles = (Array.isArray(refs) ? refs : [])
    .map((r: any) => (typeof r === 'string' ? resolve(r) : r))
    .filter(Boolean);

  const mutualNames = profiles.map(displayName).filter(Boolean);
  const mutualPictures = profiles.map((p: any) => profilePictureUrl(p, 100, resolve)).filter(Boolean);

  const declared = Number(shared.totalCount ?? shared.numSharedConnections ?? NaN);
  const mutualCount = Number.isFinite(declared) ? declared : mutualNames.length;
  if (!mutualCount && !mutualNames.length) return none;
  return { mutualCount, mutualNames, mutualPictures };
}

export interface NormalizedInvitations {
  invitations: Invitation[];
  /** Sender profiles, for the shared `profiles` table. */
  profiles: Profile[];
  /** Raw invitation-entity count before any were dropped (drives the paging walk). */
  rawCount: number;
}

export function normalizeInvitations(raw: any): NormalizedInvitations {
  const entities = included(raw);
  const byUrn = indexByUrn(entities);
  const resolve: Resolve = (urn) => byUrn.get(String(urn));

  const profilesById = new Map<string, any>();
  for (const e of entities) {
    const t = String(e?.$type || '');
    if (t.endsWith('shared.MiniProfile') || t.endsWith('profile.Profile')) {
      const id = String(e.entityUrn || '').split(':').pop();
      if (id) profilesById.set(id, e);
    }
  }

  const viewByInvitation = new Map<string, any>();
  for (const e of entities) {
    if (!String(e?.$type || '').endsWith('InvitationView')) continue;
    const target = ref(e, 'invitation');
    if (target) viewByInvitation.set(target, e);
  }

  const invitations: Invitation[] = [];
  const profiles: Profile[] = [];
  let rawCount = 0;
  for (const e of entities) {
    if (!String(e?.$type || '').endsWith('invitation.Invitation')) continue;
    rawCount++;
    const id = String(e.entityUrn || '').split(':').pop() || '';
    if (!id) continue;
    const fromRef = ref(e, 'fromMember') || ref(e, 'inviter');
    const memberId = fromRef.split(':').pop() || '';
    const p = profilesById.get(memberId) ?? resolve(fromRef);
    const name = displayName(p) || 'LinkedIn Member';
    const headline = String(p?.occupation || p?.headline || '');
    const pictureUrl = profilePictureUrl(p, 100, resolve);
    const publicId = String(p?.publicIdentifier || '');
    const fromUrn = toFsdProfileUrn(fromRef);
    const msg = e.message;
    invitations.push({
      id,
      sharedSecret: String(e.sharedSecret || ''),
      fromUrn,
      name,
      headline,
      pictureUrl,
      publicId,
      message: typeof msg === 'string' ? msg : String(msg?.text || ''),
      sentAt: Number(e.sentTime || e.sentAt || 0),
      status: 'pending',
      ...insightFrom(viewByInvitation.get(String(e.entityUrn)), resolve),
    });
    if (fromUrn) {
      profiles.push({
        urn: fromUrn,
        publicId,
        firstName: String(p?.firstName || ''),
        lastName: String(p?.lastName || ''),
        fullName: name,
        occupation: headline,
        location: '',
        pictureUrl,
      });
    }
  }
  return { invitations, profiles, rawCount };
}

/** Server-side paging metadata, when present. `total` is the authoritative stop. */
export function invitationPaging(raw: any): { total: number } | null {
  const p = raw?.data?.paging ?? raw?.paging;
  const total = Number(p?.total ?? NaN);
  return Number.isFinite(total) && total >= 0 ? { total } : null;
}
