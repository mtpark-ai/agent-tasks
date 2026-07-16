/// <reference types="@cloudflare/workers-types" />

/**
 * Worker fetch handlers receive incoming requests whose `cf` metadata uses
 * `IncomingRequestCfProperties`. Tests construct Request objects directly, so
 * align the default generic used by test helpers with the handler contract.
 */
interface Request<
  CfHostMetadata = unknown,
  Cf = IncomingRequestCfProperties<CfHostMetadata>,
> {}
