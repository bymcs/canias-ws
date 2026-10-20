export { CaniasClient } from "./client.js";
export { configFromEnv, resolveConfig } from "./config.js";
export type { NormalizedConfig } from "./config.js";
export {
  CaniasConfigError,
  CaniasError,
  CaniasLoginError,
  CaniasProtocolError,
  CaniasServiceError,
  CaniasSoapFaultError,
  CaniasTransportError,
} from "./errors.js";
export type { CaniasErrorCode } from "./errors.js";
export { MemorySessionStore } from "./session.js";
export type {
  CaniasCallOptions,
  CaniasCallResult,
  CaniasConfig,
  CaniasParamValue,
  CaniasParams,
  CaniasSession,
  SessionStore,
} from "./types.js";
export {
  CANIAS_NAMESPACE,
  buildEnvelope,
  buildParameters,
  childNode,
  childText,
  childrenOf,
  escapeXml,
  findChild,
  parseOperationResponse,
  tagOf,
  textOf,
} from "./xml.js";
export type {
  ParsedOperation,
  SoapFault,
  XmlNode,
  XmlParam,
  XmlParamType,
} from "./xml.js";
export { VERSION } from "./version.js";
