/// <reference types="@cloudflare/workers-types" />

interface Request<
  CfHostMetadata = unknown,
  Cf = IncomingRequestCfProperties<CfHostMetadata>,
> {}
