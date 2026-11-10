export interface SearchConsoleEnv {
  SEARCH_CONSOLE_CLIENT_ID?: string;
  SEARCH_CONSOLE_CLIENT_SECRET?: string;
  /** JSON {current,keys}; each key is a base64url-encoded 32-byte AES key. */
  SEARCH_CONSOLE_TOKEN_KEYS?: string;
  /** Trusted fixture transport, accepted only in explicit local fixture mode. */
  SEARCH_CONSOLE_HTTP?: Pick<Fetcher,'fetch'>;
  SEARCH_CONSOLE_FIXTURE_MODE?: string;
}
export class SearchConsoleError extends Error {
  status:number;code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
