const MANIFEST_URL = "data/domain-packs-manifest.json";

let manifestCache = null;
const packCache = new Map();

export async function loadManifest() {
  if (manifestCache) return manifestCache;
  const embedded = readEmbeddedManifest();
  if (location.protocol === "file:") {
    manifestCache = embedded;
    return manifestCache;
  }
  try {
    const res = await fetch(MANIFEST_URL);
    if (res.ok) {
      manifestCache = await res.json();
      return manifestCache;
    }
  } catch {
    /* fallback */
  }
  manifestCache = embedded;
  return manifestCache;
}

export async function loadDomainPack(packId) {
  if (packCache.has(packId)) return packCache.get(packId);
  const manifest = await loadManifest();
  const entry = manifest.packs?.find((p) => p.id === packId);
  if (!entry?.packFile) throw new Error("pack not found");
  if (location.protocol !== "file:") {
    try {
      const res = await fetch(`data/${entry.packFile}`);
      if (res.ok) {
        const pack = await res.json();
        packCache.set(packId, pack);
        return pack;
      }
    } catch {
      /* fallback */
    }
  }
  const embedded = readEmbeddedPacks();
  const pack = embedded[packId];
  if (!pack) throw new Error("pack not found");
  packCache.set(packId, pack);
  return pack;
}

function readEmbeddedManifest() {
  const el = document.getElementById("cg-embedded-manifest");
  if (!el) return { version: 1, defaultPackId: "project-controls", packs: [] };
  try {
    return JSON.parse(el.textContent);
  } catch {
    return { version: 1, defaultPackId: "project-controls", packs: [] };
  }
}

function readEmbeddedPacks() {
  const el = document.getElementById("cg-embedded-packs");
  if (!el) return {};
  try {
    return JSON.parse(el.textContent);
  } catch {
    return {};
  }
}

export function criteriaFromPack(pack, source = "pack") {
  const mapItem = (text) => ({
    id: crypto.randomUUID?.() || String(Date.now() + Math.random()),
    text,
    source,
    active: true,
  });
  return {
    mustHaves: (pack.seedMustHaves || []).map(mapItem),
    preferred: (pack.seedPreferred || []).map(mapItem),
    dealBreakers: (pack.seedDealBreakers || []).map(mapItem),
  };
}
