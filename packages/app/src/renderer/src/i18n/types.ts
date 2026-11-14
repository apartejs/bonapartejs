/**
 * Every string the interface shows. One file per language implements this
 * shape, and a spec checks that they hold the same keys. Nothing here is ever
 * sent to a model: that side is English, always.
 */
export interface Messages {
  app: {
    name: string;
  };
  composer: {
    placeholder: string;
  };
  chat: {
    empty: string;
  };
}
