import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Transient "flash" highlight for text Dune just wrote/rewrote. Implemented as
 * a ProseMirror decoration (view-only), so it never serializes into the stored
 * markdown. Call flashRange(from, to) then clearFlash() after the animation.
 */
export const flashKey = new PluginKey("duneFlash");

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    duneFlash: {
      flashRange: (from: number, to: number) => ReturnType;
      clearFlash: () => ReturnType;
    };
  }
}

export const FlashHighlight = Extension.create({
  name: "duneFlash",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(flashKey);
            if (meta?.clear) return DecorationSet.empty;
            if (meta) {
              const deco = Decoration.inline(meta.from, meta.to, { class: "dune-flash" });
              return DecorationSet.create(tr.doc, [deco]);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return flashKey.getState(state);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      flashRange:
        (from: number, to: number) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(flashKey, { from, to }));
          return true;
        },
      clearFlash:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(flashKey, { clear: true }));
          return true;
        },
    };
  },
});
