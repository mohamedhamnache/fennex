/** Fetch a remote image and return it as a data URI.
 *  Rasterising an SVG that references a remote image taints the canvas and
 *  makes toDataURL throw, so every remote reference must be inlined first. */
async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Could not load image for export: ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image for export"));
    reader.readAsDataURL(blob);
  });
}

function needsInlining(url: string): boolean {
  return !url.startsWith("data:");
}

/** Replace every remote image URL in a scene with a data URI.
 *  Returns a new scene; the input is not mutated. */
export async function inlineSceneImages<T extends {
  baseImageUrl: string | null;
  layers: { type: string; imageUrl?: string }[];
}>(scene: T): Promise<T> {
  const cache = new Map<string, Promise<string>>();
  const resolve = (url: string) => {
    if (!cache.has(url)) cache.set(url, toDataUri(url));
    return cache.get(url)!;
  };

  const base = scene.baseImageUrl && needsInlining(scene.baseImageUrl)
    ? await resolve(scene.baseImageUrl)
    : scene.baseImageUrl;

  const layers = await Promise.all(
    scene.layers.map(async (l) => {
      if (l.type !== "image" || !l.imageUrl || !needsInlining(l.imageUrl)) return l;
      return { ...l, imageUrl: await resolve(l.imageUrl) };
    }),
  );

  return { ...scene, baseImageUrl: base, layers };
}
