/**
 * Received connection invitations. Ported from main's Network feature, scoped to
 * received invitations (the "someone wants to connect" inbox). Sent invitations
 * can follow later.
 */

/** Shared-connection context, from the `includeInsights=true` payload. */
export interface InvitationInsight {
  /** How many connections you and the sender have in common (0 if unknown). */
  mutualCount: number;
  /** Names of the mutuals the payload named — in practice one, not all of them. */
  mutualNames: string[];
  /** Their avatars, for the face row. Same order as `mutualNames`. */
  mutualPictures: string[];
}

export interface Invitation extends InvitationInsight {
  /** Numeric invitation id (tail of urn:li:fs_relInvitation:...) — primary key. */
  id: string;
  /** Secret required by the accept/ignore endpoint. */
  sharedSecret: string;
  /** Sender, normalized to urn:li:fsd_profile:<memberId>. */
  fromUrn: string;
  name: string;
  headline: string;
  pictureUrl: string;
  publicId: string;
  /** Custom note attached to the request ('' if none). */
  message: string;
  sentAt: number;
  status: 'pending' | 'accepted' | 'ignored';
}
