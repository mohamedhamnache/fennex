import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Change highlighting for Dune edits, as ProseMirror decorations (view-only,
 * never serialized into the stored markdown). Two independent layers:
 * - flash: a transient wash on text Dune just wrote/rewrote (auto-cleared).
 * - persist: a lasting highlight on changed blocks, toggled by "Show changes".
 */
export const flashKey = new PluginKey("duneFlash");

export interface FlashRange {
  from: number;
  to: number;
}

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    duneFlash: {
      flashRange: (from: number, to: number) => ReturnType;
      flashRanges: (ranges: FlashRange[]) => ReturnType;
      clearFlash: () => ReturnType;
      setChangedRanges: (ranges: FlashRange[], title?: string) => ReturnType;
      clearChanged: () => ReturnType;
    };
  }
}

interface FlashState {
  flash: DecorationSet;
  persist: DecorationSet;
}

function decos(doc: import("@tiptap/pm/model").Node, ranges: FlashRange[], cls: string, title?: string) {
  const attrs = title ? { class: cls, title } : { class: cls };
  return DecorationSet.create(
    doc,
    ranges.filter((r) => r.to > r.from).map((r) => Decoration.inline(r.from, r.to, attrs)),
  );
}

export const FlashHighlight = Extension.create({
  name: "duneFlash",

  addProseMirrorPlugins() {
    return [
      new Plugin<FlashState>({
        key: flashKey,
        state: {
          init: () => ({ flash: DecorationSet.empty, persist: DecorationSet.empty }),
          apply(tr, old) {
            let flash = old.flash.map(tr.mapping, tr.doc);
            let persist = old.persist.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(flashKey);
            if (meta) {
              if (meta.clearFlash) flash = DecorationSet.empty;
              if (meta.flash) flash = decos(tr.doc, meta.flash, "dune-flash");
              if (meta.clearPersist) persist = DecorationSet.empty;
              if (meta.persist) persist = decos(tr.doc, meta.persist, "dune-changed", meta.persistTitle);
            }
            return { flash, persist };
          },
        },
        props: {
          decorations(state) {
            const s = flashKey.getState(state) as FlashState | undefined;
            if (!s) return null;
            return s.flash.add(state.doc, s.persist.find());
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
          if (dispatch) dispatch(tr.setMeta(flashKey, { flash: [{ from, to }] }));
          return true;
        },
      flashRanges:
        (ranges: FlashRange[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(flashKey, { flash: ranges }));
          return true;
        },
      clearFlash:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(flashKey, { clearFlash: true }));
          return true;
        },
      setChangedRanges:
        (ranges: FlashRange[], title?: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(flashKey, { persist: ranges, persistTitle: title }));
          return true;
        },
      clearChanged:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(flashKey, { clearPersist: true }));
          return true;
        },
    };
  },
});
