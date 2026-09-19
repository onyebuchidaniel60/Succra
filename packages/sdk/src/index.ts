// Succra SDK — public surface (thin typed client; no strategy logic).
export { SuccraAgentClient } from './client.js';
export type {
  AttachAgentInput,
  ExpectedAction,
  PreflightAllow,
  PreflightBlock,
  PreflightInput,
  PreflightResult,
  SdkOptions,
  SubmitResult,
} from './client.js';
export { SdkError, SdkRefusal, parseGatewayError, type GatewayErrorBody } from './errors.js';
export {
  agentKeypairFromSecretKey,
  agentPublicKeyBase58,
  agentSecretKeyBase64,
  createAgentKeypair,
  type AgentKeypair,
} from './keys.js';
export { verifyAndSignPreflight } from './verify.js';
