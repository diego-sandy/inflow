import { ConnectorGuide } from './ConnectorGuide';
import type { StepContext } from './SetupSteps';

/** The setup wizard's MCP connector step: the shared guide, wired to the wizard. */
export function ClaudeStep({ ctx }: { ctx: StepContext }) {
  return <ConnectorGuide onBack={ctx.back} onSkip={ctx.next} onFinish={ctx.next} />;
}
