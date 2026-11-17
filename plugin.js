// Plugin de Kino multi-fuente (sitios WordPress de cómics).
// Interfaz tipo lector de manga: Inicio, Biblioteca, Favoritos,
// Historial, detalle de cómic y lector vertical, con FUENTES
// conmutables por chips (patrón de pestañas de MangaTrack, de
// Susejing). Basado en la arquitectura del plugin Yuri Online (de
// Hotaru Yume), que a su vez sigue el patrón de ZonaTM0/MangaTrack:
//   - Inicio por categorías: secciones por etiqueta debajo de «Seguir
//     leyendo» y «Mis favoritos», sin repetidos y con «Ver más».
//   - Nada bloquea la pantalla: detalle, Inicio y Biblioteca se pintan
//     AL INSTANTE con esqueletos y los datos llegan en segundo plano
//     por el temporizador «every».
//   - Lector SIEMPRE a pantalla completa: sin barra propia ni botón
//     flotante; «Volver al detalle» está en la tarjeta del final.
//   - Las páginas viven en kino.storage: el estado de la pantalla
//     queda mínimo y los cómics largos no desbordan el límite de Kino.
// Capa de datos por sitio (WordPress) con DOBLE CAMINO — si uno
// falla (sitio caído, filtro del servidor, red lenta), se usa el otro:
//   1. API REST (liviana y estructurada):
//      - Listados y búsqueda: /wp-json/wp/v2/posts?…  (+_embed: portada)
//      - Secciones:           /wp-json/wp/v2/posts?<tax>=<id>…
//      - Cómic:               /wp-json/wp/v2/posts?slug=<slug>…
//      - Páginas en orden:    /wp-json/wp/v2/media?parent=<id>…
//   2. HTML de las páginas del sitio (como el plugin Yuri Online):
//      - Listados:  /page/N/  ·  Búsqueda:  /?s=<q>
//      - Cómic:     metadatos og:* y galería de imágenes
// Marcaje de contenido: el manifiesto declara «categories: ["adult"]»
// y «screen.adult: true», y cada tarjeta lleva «adult: true» — lo que
// Kino exige para aplicar su filtro parental. El plugin nunca intenta
// detectar ni saltarse ese bloqueo.
//
// Requiere Kino 0.9.74 o superior (apiVersion 14, capabilities
// "screen" y "shared").
//
// v2.4.3 — multi-fuente: TMOHentai con las rutas actuales del sitio
//   (/biblioteca, lector /view_uploads), VerMangasPorno fuera (bloquea
//   las imágenes fuera de su web), selector de fuentes con chips.
//   - Dos fuentes conmutables con chips (VerMangasPorno en español y
//     KingComix), misma receta de datos para las dos.
//   - Páginas de cada cómic por el endpoint de adjuntos (orden de
//     lectura ascendente), con la galería del contenido de respaldo.
//   - Portadas de los listados por _embedded (destacada del post).
//   - Se conservan todas las correcciones de v1.0.1 (peticiones
//     livianas, respaldo HTML, errores visibles con «Reintentar»,
//     temporizador sin ticks apilados).

const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const PER_PAGE = 18; // cómics por página de listado
const LIB_MAX = 144; // tope de cómics acumulados en la Biblioteca (estado pequeño)
const PAGES_MAX = 300; // tope de páginas por cómic (límite de nodos de Kino)
const MEDIA_PER = 100; // adjuntos por petición (tope REST de WordPress)

// Las fuentes. «tax» de cada sección: taxonomy REST de WordPress.
// «cardRe»: expresión para el respaldo HTML (grupo 1 = URL, 2 = slug).
const SITES = [
  {
    id: "rey", name: "ReyComix", base: "https://reycomix.com",
    comicPath: "",
    cardRe: 'href="(https:\\/\\/reycomix\\.com\\/([a-z0-9][a-z0-9-]{4,})\\/?)"',
    sections: [
      { key: "r58", tax: "categories", id: 58, label: "Hentai", labelEn: "Hentai" },
      { key: "rTagSC", tax: "tags", id: 457, label: "Sin Censura", labelEn: "Uncensored" },
      { key: "r16", tax: "tags", id: 16, label: "Full Color", labelEn: "Full Color" },
      { key: "r57", tax: "tags", id: 57, label: "Comics 3D", labelEn: "3D Comics" },
      { key: "r7", tax: "categories", id: 7, label: "Comics Porno", labelEn: "Porn Comics" },
      { key: "r44", tax: "categories", id: 44, label: "Anime XXX", labelEn: "Anime XXX" },
      { key: "r60", tax: "categories", id: 60, label: "Pokemon", labelEn: "Pokemon" },
    ],
  },
  {
    id: "mela", name: "MelaPelaComics", base: "https://melapelacomics.com",
    comicPath: "",
    cardRe: 'href="(https:\\/\\/melapelacomics\\.com\\/([a-z0-9][a-z0-9-]{4,})\\/?)"',
    sections: [
      { key: "m3", tax: "categories", id: 3, label: "Hentai", labelEn: "Hentai" },
      { key: "mTagSC", tax: "tags", id: 1537, label: "Sin Censura", labelEn: "Uncensored" },
      { key: "m6", tax: "categories", id: 6, label: "Comics 3D", labelEn: "3D Comics" },
      { key: "m1461", tax: "categories", id: 1461, label: "Cartoons", labelEn: "Cartoons" },
      { key: "m5", tax: "categories", id: 5, label: "Incesto", labelEn: "Incest" },
      { key: "m2", tax: "categories", id: 2, label: "Interraciales", labelEn: "Interracial" },
    ],
  },
  {
    id: "cpa", name: "ComicsParaAdultos", base: "https://comicsparaadultos.com",
    comicPath: "",
    cardRe: 'href="(https:\\/\\/comicsparaadultos\\.com\\/([a-z0-9][a-z0-9-]{4,})\\/?)"',
    sections: [
      { key: "cpa16", tax: "categories", id: 16, label: "Comics 3D", labelEn: "3D Comics" },
      { key: "cpa17", tax: "categories", id: 17, label: "Mangas", labelEn: "Manga" },
      { key: "cpa10", tax: "categories", id: 10, label: "Incesto", labelEn: "Incest" },
      { key: "cpa34", tax: "categories", id: 34, label: "Caricaturas", labelEn: "Cartoons" },
      { key: "cpa55", tax: "categories", id: 55, label: "Interracial", labelEn: "Interracial" },
    ],
  },
  {
    id: "t3d", name: "Tangas3D", base: "https://tangas3d.com",
    comicPath: "",
    cardRe: 'href="(https:\\/\\/tangas3d\\.com\\/([a-z0-9][a-z0-9-]{4,})\\/?)"',
    sections: [
      { key: "t532", tax: "categories", id: 532, label: "CrazyDad3D", labelEn: "CrazyDad3D" },
      { key: "t397", tax: "categories", id: 397, label: "Y3DF", labelEn: "Y3DF" },
      { key: "t570", tax: "categories", id: 570, label: "Pig King", labelEn: "Pig King" },
      { key: "t437", tax: "categories", id: 437, label: "Comics 3D", labelEn: "3D Comics" },
      { key: "t391", tax: "categories", id: 391, label: "Blackadder", labelEn: "Blackadder" },
      { key: "t457", tax: "categories", id: 457, label: "Moiarte", labelEn: "Moiarte" },
    ],
  },
];

function prefFuenteId() {
  const id = getJson("prefFuente", null);
  if (id && SITES.some((s) => s.id === id)) return id;
  return SITES[0].id;
}

function siteDe(state) {
  const id = (state && state.fuente) || prefFuenteId();
  return SITES.find((s) => s.id === id) || SITES[0];
}

function siteOfId(id) {
  return SITES.find((s) => s.id === id) || SITES[0];
}

// orden natural por el primer número del nombre de archivo (main01 <
// main02 < main106); estable si alguno no tiene número
function sortPages(pages) {
  const num = (u) => {
    const f = String(u).split("/").pop() || "";
    const m = f.match(/\d+/);
    return m ? parseInt(m[0], 10) : -1;
  };
  return pages.map((p, i) => [p, i])
    .sort((a, b) => (num(typeof a[0] === "string" ? a[0] : a[0].url) - num(typeof b[0] === "string" ? b[0] : b[0].url)) || (a[1] - b[1]))
    .map((x) => x[0]);
}

// Páginas de un cómic por el endpoint de adjuntos de WordPress, en
// orden de lectura (fecha ascendente), con orden natural de nombre de
// archivo. Hasta MEDIA_PAGES peticiones (100 adjuntos cada una).
async function mediaPages(site, postId) {
  const out = [];
  for (let pg = 1; pg <= 3 && out.length < PAGES_MAX; pg++) {
    const arr = await getApi(site, "/media?parent=" + postId +
      "&per_page=" + MEDIA_PER + "&page=" + pg +
      "&orderby=date&order=asc&_fields=source_url", 20000);
    if (!Array.isArray(arr) || !arr.length) break;
    for (const m of arr) {
      if (m && m.source_url && /\.(webp|jpe?g|png|gif)(\?|$)/i.test(m.source_url)) {
        out.push(m.source_url);
        if (out.length >= PAGES_MAX) break;
      }
    }
  }
  return out.length ? sortPages(out.map((u) => ({ url: u }))).map((x) => x.url) : [];
}

function headersDe(site) {
  return {
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "es",
    Referer: site.base + "/",
    "User-Agent": UA,
  };
}

// Warmup suave: una visita a la home por fuente (cada ~10 min) para
// establecer cookies de sesión / CF ligero antes de la API o el HTML.
// No resuelve challenges duros; evita el primer 403 intermitente.
const WARM_TTL_MS = 600000;
const warmAt = {};

async function warmSite(site) {
  if (!site || !site.base) return;
  const id = site.id || site.base;
  const now = Date.now();
  if (warmAt[id] && now - warmAt[id] < WARM_TTL_MS) return;
  try {
    await kino.fetch(site.base + "/", {
      headers: headersDe(site),
      timeoutMs: 8000,
    });
  } catch (e) {
    kino.log("warm", (site.id || "") + " " + (e && e.message ? e.message : e));
  }
  warmAt[id] = Date.now();
}

// ---------------------------------------------------------------- red

// Petición JSON a la API REST. Lanza un error «network» si el sitio no
// responde o devuelve algo que no es JSON.
async function getApi(site, path, timeoutMs) {
  await warmSite(site);
  const r = await kino.fetch(site.base + "/wp-json/wp/v2" + path, {
    headers: headersDe(site),
    timeoutMs: timeoutMs || 15000,
  });
  if (!r.ok) throw kino.error("network", "HTTP " + r.status, {
    userMessage: "No se pudo conectar con el sitio. Inténtalo de nuevo.",
  });
  let data;
  try { data = JSON.parse(r.text()); } catch (e) {
    throw kino.error("network", "bad json", {
      userMessage: "El sitio devolvió una respuesta inesperada. Inténtalo de nuevo.",
    });
  }
  return data;
}

// Petición HTML a una página del sitio (respaldo).
async function getHtml(site, path, timeoutMs) {
  await warmSite(site);
  const r = await kino.fetch(site.base + path, {
    headers: headersDe(site),
    timeoutMs: timeoutMs || 20000,
  });
  if (!r.ok) throw kino.error("network", "HTTP " + r.status, {
    userMessage: "No se pudo conectar con el sitio. Inténtalo de nuevo.",
  });
  return r.text();
}

// Listado de cómics con doble camino: primero la API REST; si falla o
// no trae nada, el HTML de la página correspondiente. Devuelve SIEMPRE
// una lista o lanza «network» (para que la pantalla muestre el error).
async function getCards(site, page, q, sec) {
  const p = parseInt(page, 10) || 1;
  const per = q ? Math.max(PER_PAGE, 30) : PER_PAGE;
  // 1) REST (con _embed: trae la portada destacada de cada cómic)
  try {
    let paths = [];
    if (sec && sec.tax && sec.id != null) {
      paths = ["/posts?" + sec.tax + "=" + sec.id + "&per_page=" + per + "&page=" + p + "&_embed"];
    } else if (q) {
      const qq = encodeURIComponent(q);
      // Varias estrategias: relevance, search simple, y búsqueda ampliada
      paths = [
        "/posts?search=" + qq + "&per_page=" + per + "&page=" + p + "&_embed&orderby=relevance",
        "/posts?search=" + qq + "&per_page=" + per + "&page=" + p + "&_embed",
        "/posts?search=" + qq + "&per_page=" + per + "&page=" + p + "&_embed&orderby=date",
      ];
    } else if (!sec) {
      paths = ["/posts?per_page=" + per + "&page=" + p + "&_embed"];
    }
    for (const path of paths) {
      try {
        const arr = await getApi(site, path, 14000);
        if (Array.isArray(arr) && arr.length) return postsToCards(arr, site);
        if (Array.isArray(arr) && !q) return []; // fin real de listado
      } catch (e1) { kino.log("rest", e1.message); }
    }
  } catch (e) { kino.log("rest", e.message); }
  // 2) HTML (respaldo o sección por pathHtml)
  let htmlPaths = [];
  if (q) {
    const qq = encodeURIComponent(q);
    htmlPaths = ["/?s=" + qq, "/search/" + qq + "/", "/?s=" + qq + "&post_type=post"];
  } else if (sec && sec.pathHtml) {
    let hp = sec.pathHtml;
    if (p > 1) {
      if (hp.indexOf("?") >= 0) hp = hp + "&page=" + p;
      else hp = hp.replace(/\/?$/, "") + "/page/" + p + "/";
    }
    htmlPaths = [hp];
  } else {
    htmlPaths = ["/page/" + p + "/"];
  }
  for (const htmlPath of htmlPaths) {
    try {
      const html = await getHtml(site, htmlPath, 20000);
      const cards = htmlCards(html, 40, site);
      if (cards.length) return cards;
    } catch (e2) { kino.log("html", e2.message); }
  }
  return [];
}

// ------------------------------------------------------------- scraping

function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => {
      const c = parseInt(n, 10);
      return c > 0 && c < 65536 ? String.fromCharCode(c) : "";
    })
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

// Primera imagen del contenido (la portada: la página 1 del cómic).
// Genérica: cualquier galería de WordPress (/wp-content/uploads/).
function firstImg(content) {
  const imgs = readerImages(content);
  return imgs.length ? imgs[0].url : "";
}

// Entradas del REST → tarjetas. Portada: la imagen destacada
// (_embedded, que trae el _embed del listado); si no, la primera del
// contenido. Cada tarjeta lleva «adult: true» (marca que Kino exige
// para su filtro parental).
function postsToCards(arr, site) {
  const out = [];
  const seen = {};
  for (const p of arr || []) {
    if (!p || !p.slug || seen[p.slug]) continue;
    seen[p.slug] = true;
    const content = p.content && p.content.rendered ? p.content.rendered : "";
    let poster = "";
    const emb = p._embedded && p._embedded["wp:featuredmedia"] && p._embedded["wp:featuredmedia"][0];
    if (emb && emb.source_url) poster = emb.source_url;
    if (!poster) poster = firstImg(content);
    out.push({
      slug: p.slug,
      url: p.link || site.base + "/" + p.slug + "/",
      title: decode(p.title && p.title.rendered ? p.title.rendered : p.slug),
      poster: poster,
      adult: true,
    });
  }
  return out;
}

// rutas de una sola pieza que NO son cómics (menú, paginación, legales…)
const NO_SERIE = {
  "comics-exclusivos": true, favoritos: true, "comics-random": true,
  etiquetas: true, login: true, register: true, "sex-comics": true,
  "lista-de-artistas": true, "aviso-legal": true,
  porno: true, page: true, feed: true, comments: true, search: true,
  tag: true, category: true, author: true, autor: true,
  "wp-json": true, "wp-content": true, "wp-admin": true, "wp-login": true,
  contacto: true, dmca: true, "politica-de-privacidad": true,
  "terminos-y-condiciones": true, "politica-de-cookies": true,
  "sobre-nosotros": true, 18: true, en: true,
};

// Tarjetas desde el HTML de un listado (respaldo): enlaces de cómic
// según el patrón de cada sitio, que no sean páginas fijas, con la
// primera imagen cercana como portada y el texto del enlace (o el alt
// de la imagen) como título.
function htmlCards(html, max, site) {
  const out = [];
  const seen = {};
  const re = new RegExp(site.cardRe, "g");
  let m;
  while ((m = re.exec(html)) !== null && out.length < (max || 40)) {
    const url = m[1], slug = m[2];
    if (seen[slug] || NO_SERIE[slug]) continue;
    seen[slug] = true;
    const win = html.slice(m.index, m.index + 2500);
    const im = win.match(/<img[^>]+(?:data-src|src)="(https?:\/\/[^"\s]*?\/wp-content\/uploads\/[^"\s]+?\.(?:webp|jpe?g|png|gif))"/);
    let title = "";
    const tre = new RegExp('href="' + url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[^>]*>([^<]{1,150})<', "g");
    let t;
    while ((t = tre.exec(win)) !== null) {
      const txt = decode(t[1]);
      if (txt.length > 1) { title = txt; break; }
    }
    if (!title && im) title = decode((im[1].split("/").pop() || "").replace(/\.[a-z]+$/, "").replace(/-\d+x\d+$/, "")).replace(/-/g, " ");
    out.push({ slug: slug, url: url, poster: im ? im[1] : "", title: title || slug.replace(/-/g, " "), adult: true });
  }
  return out;
}

// JSON de una ruta del sitio (para APIs que no son WordPress, como la
// del lector de TMOHentai).
async function getJsonUrl(site, path, timeoutMs) {
  const r = await kino.fetch(site.base + path, {
    headers: headersDe(site),
    timeoutMs: timeoutMs || 15000,
  });
  if (!r.ok || (r.status && r.status >= 400)) {
    throw kino.error("network", "HTTP " + (r.status || "?"));
  }
  let txt = "";
  try { txt = r.text(); } catch (e) { /* cuerpo vacío */ }
  try { return JSON.parse(txt); } catch (e) { throw kino.error("network", "no-json"); }
}

// Tarjetas desde el HTML de TMOHentai (/comics): enlaces
// «/library/<tipo>/<id>/<slug>» con su título y portada cercana.




// Imágenes de un cómic (galería del contenido, en orden de lectura).
// Genérica: cualquier galería de WordPress (/wp-content/uploads/).
function normalizeImgUrl(u) {
  if (!u) return "";
  try {
    // decodifica y vuelve a codificar para caracteres raros (– en nombres)
    u = String(u).trim().replace(/&amp;/g, "&");
    // encodeURI mantiene : / ? = y codifica espacios y unicode del path
    return encodeURI(decodeURI(u));
  } catch (e) {
    try { return encodeURI(u); } catch (e2) { return u; }
  }
}

function readerImages(content) {
  const html = String(content || "");
  const out = [], seen = {};
  const push = (raw) => {
    if (!raw) return;
    let u = raw.trim();
    if (u.indexOf("//") === 0) u = "https:" + u;
    if (!/^https?:\/\//i.test(u)) return;
    if (!/\.(webp|jpe?g|png|gif)(\?|$)/i.test(u)) return;
    u = normalizeImgUrl(u);
    if (!u || seen[u]) return;
    if (/(?:^|[^a-z])(?:logo|icon|avatar|emoji|badge|button|flag|sprite|smiley|banner|favicon|placeholder|spinner)(?:[^a-z]|$)|\/(?:ads?|banners?)\b|wp-includes|gravatar|loading\.gif/i.test(u)) return;
    if (/-\d{2,3}x\d{2,3}\.(?:webp|jpe?g|png)/i.test(u) && !/uploads/i.test(u)) return;
    seen[u] = true;
    out.push({ url: u, w: 0, h: 0 });
  };
  // src / data-src / data-lazy-src / data-full / data-original
  const re = /(?:src|data-src|data-lazy-src|data-full|data-original|data-url)="?(https?:\/\/[^"\s>]+|\/\/[^"\s>]+)"?/gi;
  let m;
  while ((m = re.exec(html)) !== null) push(m[1]);
  // srcset: tomar la URL más grande
  const reSet = /srcset="([^"]+)"/gi;
  while ((m = reSet.exec(html)) !== null) {
    const parts = m[1].split(",");
    let best = "", bestW = 0;
    for (const part of parts) {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) continue;
      const w = parseInt((bits[1] || "0").replace(/[^\d]/g, ""), 10) || 0;
      if (!best || w >= bestW) { best = bits[0]; bestW = w; }
    }
    if (best) push(best);
  }
  return out;
}


// Metadatos desde el HTML de la entrada (respaldo): og:* + galería.
function seriesMetaHtml(html, slug) {
  const pick = (re) => { const m = html.match(re); return m ? decode(m[1]) : ""; };
  return {
    title: pick(/property="og:title"[^>]*content="([^"]+)"/) || pick(/content="([^"]+)"[^>]*property="og:title"/) || slug.replace(/-/g, " "),
    poster: pick(/property="og:image"[^>]*content="([^"]+)"/) || pick(/content="([^"]+)"[^>]*property="og:image"/),
    overview: (pick(/property="og:description"[^>]*content="([^"]+)"/) || pick(/content="([^"]+)"[^>]*property="og:description"/)).slice(0, 600),
    adult: true,
  };
}

// (receta de MangaTrack, como ZonaTM0): las páginas ya no se miden.
// Con fit "width" + aspect "2:3", Kino le da a cada página su
// proporción real en cuanto la imagen carga — sin descargar cabeceras.
function pageNodes(p, i, pre) {
  return [{
    type: "Image", key: (pre || "") + "p" + i, url: typeof p === "string" ? p : p.url,
    alt: "Página " + (i + 1), altEn: "Page " + (i + 1),
    fill: true, fit: "width", aspect: "2:3",
    fallback: { type: "Column", padding: 16, children: [
      { type: "Text", text: "Página " + (i + 1), textEn: "Page " + (i + 1), color: "muted" } ] },
  }];
}

// Carga un cómic: título, portada, sinopsis y lista COMPLETA de
// páginas. REST primero, HTML de respaldo. Con caché de 15 minutos
// (force=true la salta). Tope de PAGES_MAX páginas. Lo pesado se
// guarda en kino.storage («serie:<slug>»); del estado de la pantalla
// solo viaja el meta.

async function loadSeries(site, slug, force) {
    if (!slugValido(slug)) throw kino.error("arguments", "slug");
  const ck = "serie:" + site.id + ":" + slug;
  if (!force) {
    try {
      const c = getJson(ck, null);
      if (c && c.meta && Array.isArray(c.pages) && c.pages.length &&
          Date.now() - (c.ts || 0) < 900000) {
        return { slug: slug, meta: c.meta, pages: c.pages };
      }
    } catch (e) { /* caché rota: se recarga */ }
  }
  let meta = null, pages = [];
  // 1) REST (estructurado): metadatos por slug; páginas por adjuntos
  try {
    const arr = await getApi(site, "/posts?slug=" + encodeURIComponent(slug) +
      "&_fields=id,title,content,excerpt", 30000);
    const p = arr && arr.length ? arr[0] : null;
    if (p) {
      const content = p.content && p.content.rendered ? p.content.rendered : "";
      meta = {
        title: decode(p.title && p.title.rendered ? p.title.rendered : slug),
        poster: firstImg(content),
        overview: decode(p.excerpt && p.excerpt.rendered ? p.excerpt.rendered : "").slice(0, 600),
        adult: true,
      };
      const fromContent = readerImages(content).map((x) => x.url || x);
      let fromMedia = [];
      // Solo pedir media si el contenido trae pocas páginas reales.
      // En Comics18/VCPxxx el parent media suele ser adjuntos ajenos (ads).
      if (fromContent.length < 5) {
        try { fromMedia = await mediaPages(site, p.id); } catch (e) { kino.log("media", e.message); }
      }
      // Preferir siempre el contenido si tiene una secuencia razonable
      if (fromContent.length >= 5) pages = fromContent;
      else if (fromMedia.length > fromContent.length) pages = fromMedia;
      else pages = fromContent.length ? fromContent : fromMedia;
      if (!meta.poster && pages.length) meta.poster = pages[0];
    }
  } catch (e) { kino.log("rest", e.message); }
  // 2) HTML de la entrada (respaldo si REST no trajo páginas suficientes)
  if (pages.length < 3) {
    try {
      const path = "/" + (site.comicPath || "") + slug + "/";
      const html = await getHtml(site, path.replace(/\/+/g, "/"), 30000);
      const htmlPages = readerImages(html).map((x) => x.url);
      if (htmlPages.length > pages.length) {
        pages = htmlPages;
        const hm = seriesMetaHtml(html, slug);
        if (hm.title) meta.title = hm.title;
        if (hm.poster) meta.poster = hm.poster;
        if (hm.overview) meta.overview = hm.overview;
      }
      if (!meta.poster && pages.length) meta.poster = pages[0];
    } catch (eHtml) { kino.log("htmlfb", eHtml.message); }
  }
  if (!pages.length) throw kino.error("not_found", "comic", {
    userMessage: "No se encontraron páginas para ese cómic.",
  });
  let capped = false;
  if (pages.length > PAGES_MAX) { pages = pages.slice(0, PAGES_MAX); capped = true; }
  if (capped) meta.capped = true;
  try {
    setJson(ck, { meta: meta, pages: pages, ts: Date.now() });
    const ks = kino.storage.keys().filter((k) => k.indexOf("serie:") === 0);
    if (ks.length > 10) for (const k of ks.slice(0, ks.length - 10)) kino.storage.remove(k);
  } catch (e) { kino.log("cache", e.message); }
  return { slug: slug, meta: meta, pages: pages };
}

// páginas de un cómic desde kino.storage (sin caducidad: la lista
// completa no viaja nunca en el estado de la pantalla). null si no
// está en caché.
function pagesDe(site, slug) {
  if (!slugValido(slug)) return null;
  const c = getJson("serie:" + site.id + ":" + slug, null);
  return (c && Array.isArray(c.pages)) ? c.pages : null;
}

// Carga el cómic para el detalle: si falla (web caída, sin red, tiempo
// límite), deja el cómic en estado de error — con botón «Reintentar».
// Al estado solo va el meta — las páginas quedan en kino.storage y
// detailTree las lee de ahí.
async function cargarDetalle(state, slug, force) {
  const site = siteOfId(state.detail && state.detail.siteId) || siteDe(state);
  const prev = (state.detail && state.detail.slug === slug) ? state.detail : null;
  const meta0 = (prev && prev.meta) || {};
  try {
    const d = await loadSeries(site, slug, force);
    return { state: { detail: { slug: slug, siteId: site.id, meta: d.meta } } };
  } catch (e) {
    kino.log("detalle", e.message);
    return { state: { detail: { slug: slug, siteId: site.id, error: true, meta: meta0 } } };
  }
}

// ------------------------------------------------------------ almacen

function getJson(key, fallback) {
  try {
    const v = kino.storage.get(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function setJson(key, val) {
  try { kino.storage.set(key, JSON.stringify(val)); } catch (e) { kino.log("storage", e.message); }
}
function favs() { return getJson("favs", []); }
function isFav(slug) { return favs().some((f) => f.slug === slug); }
function progress() { return getJson("prog", {}); }

function markRead(slug, title, poster, chTitle, url, siteId) {
  const p = progress();
  p[slug] = { title: title, poster: poster, chTitle: chTitle, url: url, ts: Date.now(), s: siteId || "" };
  setJson("prog", p);
  syncPush("prog", p);
}

// quita UN cómic de «Seguir leyendo»/Historial
function borrarProgreso(slug) {
  const p = progress();
  if (!p[slug]) return false;
  delete p[slug];
  setJson("prog", p);
  syncPush("prog", p);
  return true;
}

// vacía todo «Seguir leyendo»/Historial
function borrarTodoProgreso() {
  setJson("prog", {});
  syncPush("prog", {});
}

// ---------------------------------------------- sincronización (kino.shared)

function syncPush(key, val) {
  try {
    if (typeof kino.shared === "object" && kino.shared !== null) kino.shared.set(key, val);
  } catch (e) { kino.log("sync", e.message); }
}

function slugValido(s) {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(s) && s.indexOf("..") < 0;
}

function syncPull() {
  try {
    if (typeof kino.shared !== "object" || kino.shared === null) return;
    const sf = kino.shared.get("favs");
    if (Array.isArray(sf)) {
      const local = favs();
      const have = {};
      for (const f of local) have[f.slug] = true;
      let changed = false;
      for (const f of sf.slice(0, 200)) {
        if (!f || typeof f !== "object" || !slugValido(f.slug)) continue;
        if (have[f.slug]) continue;
        local.push({ slug: f.slug, title: String(f.title || f.slug).slice(0, 200),
          poster: typeof f.poster === "string" ? f.poster.slice(0, 500) : "",
          u: typeof f.u === "string" ? f.u.slice(0, 500) : "" });
        have[f.slug] = true; changed = true;
      }
      if (changed) { setJson("favs", local); syncPush("favs", local); }
    }
    const sp = kino.shared.get("prog");
    if (sp && typeof sp === "object" && !Array.isArray(sp)) {
      const p = progress();
      let changed = false;
      for (const k of Object.keys(sp).slice(0, 200)) {
        if (!slugValido(k)) continue;
        const e = sp[k];
        if (!e || typeof e !== "object" || typeof e.url !== "string" || typeof e.ts !== "number") continue;
        if (p[k] && (p[k].ts || 0) >= e.ts) continue;
        p[k] = { title: String(e.title || k).slice(0, 200),
          poster: typeof e.poster === "string" ? e.poster.slice(0, 500) : "",
          chTitle: String(e.chTitle || e.url).slice(0, 200),
          url: e.url.slice(0, 500), ts: e.ts };
        changed = true;
      }
      if (changed) { setJson("prog", p); syncPush("prog", p); }
    }
  } catch (e) { kino.log("sync", e.message); }
}

// caché de lector (últimos cómics abiertos), para no volver a pedir
function readerCache(url) { return getJson("rc:" + url, null); }
function readerCachePut(url, urls) {
  try {
    const keys = kino.storage.keys().filter((k) => k.indexOf("rc:") === 0);
    if (keys.length > 4) for (const k of keys.slice(0, keys.length - 4)) kino.storage.remove(k);
  } catch (e) { /* la app vieja no lista */ }
  setJson("rc:" + url, urls);
}

// páginas de un cómic (lista de URLs de imagen) — primero la caché
// del lector, si no la de «serie:», si no la red. Si no hay, [].
async function paginasDe(site, slug) {
  const c = readerCache(slug);
  if (Array.isArray(c) && c.length) return c;
  const guardadas = pagesDe(site, slug);
  if (guardadas && guardadas.length) { readerCachePut(slug, guardadas); return guardadas; }
  const d = await loadSeries(site, slug, false);
  const urls = (d.pages || []).map((x) => (typeof x === "string" ? x : x.url));
  if (urls.length) readerCachePut(slug, urls);
  return urls;
}

// ----------------------------------------------------------- interfaz

const TABS = [
  { value: "inicio", label: "Inicio", labelEn: "Home" },
  { value: "biblioteca", label: "Biblioteca", labelEn: "Library" },
  { value: "favoritos", label: "Favoritos", labelEn: "Favourites" },
  { value: "historial", label: "Historial", labelEn: "History" },
];

// Título partido en dos filas
function twoLines(t) {
  const s = (t || "").trim();
  if (s.length <= 26) return [s];
  const mid = Math.ceil(s.length / 2);
  let cut = -1, best = 999;
  for (let i = 8; i < s.length - 3; i++) {
    if (s[i] === " ") { const d = Math.abs(i - mid); if (d < best) { best = d; cut = i; } }
  }
  if (cut < 0) cut = mid;
  let a = s.slice(0, cut).trim(), b = s.slice(cut).trim();
  if (a.length > 34) a = a.slice(0, 33).trim() + "…";
  if (b.length > 34) b = b.slice(0, 33).trim() + "…";
  return [a, b];
}

// Título/portada de las tarjetas vistas, para pintar el detalle al
// instante (antes de que llegue la página del cómic).
const CARDINFO = {};
function rememberCard(it, siteId) {
  try {
    if (it && it.slug && CARDINFO[it.slug] === undefined) {
      CARDINFO[it.slug] = { title: it.title || "", poster: it.poster || "", s: siteId || "", u: it.url || "" };
      const ks = Object.keys(CARDINFO);
      if (ks.length > 300) delete CARDINFO[ks[0]];
    }
  } catch (e) { /* sin memoria */ }
}

function posterCard(it, prefix, rail, siteId) {
  rememberCard(it, siteId);
  const img = {
    type: "Image", url: it.poster || "", aspect: "2:3",
    alt: it.title, altEn: it.title,
    fallback: { type: "Column", padding: 16, crossAxisAlignment: "center", children: [
      { type: "Icon", name: "list", color: "muted" } ] },
  };
  if (rail) img.width = 120;
  return {
    type: "Card", key: prefix + it.slug.replace(/[^a-z0-9]/gi, "-"), flush: true,
    onTap: { event: "openSeries", arg: it.slug },
    children: [img].concat(twoLines(it.title).map((ln) => (
      { type: "Text", text: ln, textEn: ln, style: "caption", padding: 8 }))),
  };
}

const EMPTY_LIB = { type: "emptyState", icon: "list", title: "Nada por aquí todavía.", titleEn: "Nothing here yet." };
const EMPTY_FAV = { type: "emptyState", icon: "heart", title: "Marca cómics con el corazón para verlos aquí.", titleEn: "Mark comics with the heart to see them here." };

// Esqueletos (receta MangaTrack): lo que se pinta mientras los datos
// llegan en segundo plano.
let skelSeq = 0;
function skelCard() {
  return { type: "Card", key: "sk" + skelSeq++, flush: true, children: [
    { type: "Skeleton", shape: "block", height: 180 },
    { type: "Skeleton", shape: "line", padding: 8 },
    { type: "Skeleton", shape: "line", padding: 8 },
  ] };
}

function skelGridNode(n) {
  const cards = [];
  for (let i = 0; i < (n || 12); i++) cards.push(skelCard());
  return {
    type: "ListView", key: "skel",
    columns: { compact: 3, medium: 4, expanded: 6 },
    items: cards,
  };
}

// estado de error con reintentar, en tamaño de fila/sección
function filaError(mensaje, evento) {
  return { type: "Card", key: "err-" + evento + "-" + skelSeq++, padding: 12, gap: 8,
    children: [{ type: "Row", gap: 8, crossAxisAlignment: "center", children: [
      { type: "Icon", name: "wifi_off", color: "muted" },
      { type: "Text", text: mensaje, textEn: mensaje, color: "muted", style: "caption", flex: 1 },
      { type: "TextButton", icon: "refresh", labelText: "Reintentar", labelTextEn: "Retry",
        onPressed: { event: evento } },
    ] }] };
}

function titleGridOf(items, eventMore, loading, done, emptyNode, siteId) {
  if (!items || !items.length) return emptyNode || EMPTY_LIB;
  const list = {
    type: "ListView", key: "grid",
    columns: { compact: 3, medium: 4, expanded: 6 },
    items: items.map((it) => posterCard(it, "c-", false, siteId || it.s)),
  };
  if (eventMore && !done) {
    list.onEndReached = { event: eventMore };
    list.loadingMore = loading === true;
  } else {
    list.done = true;
  }
  return list;
}

// Historial con dos formas de borrar el «Seguir leyendo»: mantener
// pulsada una entrada para quitar solo ese cómic, y el botón «Borrar
// todo» (pide confirmar con un segundo toque).
function historyList(state) {
  const p = progress();
  const rows = Object.keys(p).map((slug) => ({ slug: slug, p: p[slug] }))
    .sort((a, b) => b.p.ts - a.p.ts).slice(0, 50);
  const conf = state && state.confBorrar === true;
  if (!rows.length) {
    return { type: "emptyState", icon: "schedule", title: "Todavía no has leído nada.", titleEn: "You have not read anything yet." };
  }
  const items = [{
    type: "Row", key: "histHead", gap: 8, padding: 16,
    children: [
      { type: "Text", text: "Mantén pulsado un cómic para quitarlo del historial.",
        textEn: "Long-press a comic to remove it from history.",
        style: "caption", color: "muted", flex: 1 },
      { type: "ElevatedButton", key: "clearHist", icon: "delete",
        labelText: conf ? "¿Seguro? Toca otra vez" : "Borrar todo",
        labelTextEn: conf ? "Sure? Tap again" : "Clear all",
        onPressed: { event: "clearHist" } },
    ],
  }];
  for (const r of rows) {
    items.push({
      type: "ListTile", key: "h-" + r.slug.replace(/[^a-z0-9]/gi, "-"),
      title: r.p.title || r.slug,
      subtitle: r.p.chTitle || "", subtitleEn: r.p.chTitle || "",
      leading: { type: "CircleAvatar", image: r.p.poster, icon: "list" },
      onTap: { event: "openSeries", arg: r.slug },
      onLongPress: { event: "borrarProg", arg: r.slug },
    });
  }
  return { type: "ListView", key: "hist", items: items };
}

// ------------------------------------------------- categorías (como ZonaTM0)

// Las secciones del Inicio son «sections» de cada fuente (SITES).

// Tope de cómics por sección en el estado (que viaja en la pantalla):
// 12 al abrir + hasta 48 más con «Ver más».
const GENERO_MAX = 72;

// Selector de fuente (patrón de pestañas de MangaTrack): chips de
// selección única de Kino — la fuente activa queda resaltada y se
// cambia con un toque.
function chipsRow(state) {
  // Fila deslizable compacta: una sola línea horizontal, sin apilar
  // chips a pantalla completa. Ocupa poco espacio vertical.
  return {
    type: "SingleChildScrollView",
    key: "fuenteScroll",
    direction: "horizontal",
    padding: 8,
    children: [{
      type: "Chips", key: "fuente",
      options: SITES.map((s) => ({ value: s.id, label: s.name, labelEn: s.name })),
      value: siteDe(state).id,
      onChanged: { event: "fuenteSel" },
    }],
  };
}

// Una sección por etiqueta: tarjetas + «Ver más» al final. «usados» es
// el mapa compartido entre secciones: un cómic que ya salió en una
// sección anterior NO se repite.
function railGenero(state, g, usados, siteId) {
  const cats = state.cats || {};
  const cat = cats[g.key] || null;
  if (!cat) {
    // aún sin cargar: esqueletos de la sección mientras llega el tick
    const sk = [];
    for (let i = 0; i < 6; i++) sk.push({
      type: "Card", key: g.key + "sk" + i, flush: true, children: [
        { type: "Skeleton", shape: "block", width: 120, height: 180 }] });
    return [
      { type: "Text", text: g.label, textEn: g.labelEn, style: "h3", padding: 16 },
      { type: "SingleChildScrollView", key: g.key + "skr", direction: "horizontal", padding: 16,
        children: [{ type: "Row", gap: 8, children: sk }] },
    ];
  }
  const items = Array.isArray(cat.items) ? cat.items : [];
  // la carga falló por completo: error VISIBLE con reintentar — nunca
  // una sección vacía ni esqueletos eternos
  if (cat.error && !items.length) {
    return [
      { type: "Text", text: g.label, textEn: g.labelEn, style: "h3", padding: 16 },
      filaError("No se pudo cargar esta sección.", "reintentarSeccion"),
    ];
  }
  const cards = [];
  for (const it of items.slice(0, 60)) {
    if (usados[it.slug]) continue;
    usados[it.slug] = true;
    cards.push(posterCard(it, "g" + g.key + "-", true, siteId));
  }
  if (!cards.length) return [];
  if (items.length < GENERO_MAX && !cat.error) {
    // botón «Ver más» al final de la sección
    cards.push({ type: "ElevatedButton", key: "vm-" + g.key, icon: "expand_more",
      labelText: "Ver más", labelTextEn: "See more",
      onPressed: { event: "verMas", arg: g.key } });
  }
  return [
    { type: "Text", text: g.label, textEn: g.labelEn, style: "h3", padding: 16 },
    { type: "SingleChildScrollView", key: "r-" + g.key, direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8, children: cards }] },
  ];
}

// El cuerpo de las pestañas ya NUNCA espera a la red. Pinta lo que
// haya en el estado y, si falta, esqueletos: el temporizador
// «cargarRoot» trae los datos en segundo plano.
function tabBody(state) {
  const tab = state.tab || "inicio";
  if (tab === "favoritos") return titleGridOf(favs(), null, false, true, EMPTY_FAV);
  if (tab === "historial") return historyList(state);
  if (tab === "biblioteca") {
    if (state.libError) {
      return filaError("No se pudo cargar la biblioteca. Comprueba tu conexión.", "reintentarLib");
    }
    const items = Array.isArray(state.libItems) ? state.libItems : null;
    if (!items) return skelGridNode(12);
    return titleGridOf(items, "libMore", state.libLoading === true, state.libDone === true);
  }
  // inicio
  const site = siteDe(state);
  const rail = (title, titleEn, key, list) => list.length ? [
    { type: "Text", text: title, textEn: titleEn, style: "h3", padding: 16 },
    { type: "SingleChildScrollView", key: key, direction: "horizontal", padding: 16,
      children: [{ type: "Row", gap: 8, children: list.slice(0, 60).map((it) => posterCard(it, key + "-", true, it.s)) }] },
  ] : [];
  const prog = progress();
  const leyendo = Object.keys(prog)
    .map((slug) => ({ slug: slug, title: prog[slug].title, poster: prog[slug].poster, ts: prog[slug].ts || 0 }))
    .filter((x) => x.title)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);
  // secciones por etiqueta de la fuente activa, sin repetidos entre ellas
  const usados = {};
  let secciones = [];
  for (const g of site.sections) secciones = secciones.concat(railGenero(state, g, usados, site.id));
  return {
    type: "SingleChildScrollView", key: "home", flex: 1,
    children: [{
      type: "Column", children: [
        { type: "ListTile", key: "searchTile", leading: { type: "Icon", name: "search" },
          title: "Buscar cómic", titleEn: "Search a comic",
          subtitle: "Por título, p. ej. Chloe", subtitleEn: "By title, e.g. Chloe",
          trailing: { type: "Icon", name: "arrow_forward" },
          onTap: { event: "goSearch" } },
        chipsRow(state),
      ].concat(rail("Seguir leyendo", "Continue reading", "leyendo", leyendo))
        .concat(rail("Mis favoritos", "My favourites", "favs", favs()))
        .concat(secciones),
    }],
  };
}

// Biblioteca: los cómics más nuevos de la fuente activa, paginados
async function fetchLibrary(site, page) {
  return getCards(site, page, "", null);
}

// ------------------------------------------------------------- rutas

function routeSlug(r) {
  if (!r) return "";
  return String((r.args && r.args.slug) || (r.params && r.params.slug) || r.slug || "");
}

function loadingTree(msg) {
  return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: [
    { type: "CircularProgressIndicator" },
    { type: "Text", text: msg || "Cargando…", textEn: "Loading…", color: "muted" },
  ] };
}

// Pantalla de error con reintentar: para fallos de red con tiempo límite
function errorTree(msg, retryEvent, extra) {
  const children = [
    { type: "Icon", name: "error", color: "muted" },
    { type: "Text", text: msg, textEn: msg, color: "muted", padding: { left: 16, right: 16 } },
    { type: "ElevatedButton", icon: "refresh", labelText: "Reintentar", labelTextEn: "Retry",
      onPressed: { event: retryEvent || "retry" } },
  ];
  if (extra) children.push(extra);
  return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: children };
}

// Detalle mientras el cómic llega en segundo plano: esqueletos
// (receta MangaTrack) + temporizador «cargarSerie» + un botón
// «Cargar ahora» por si el Kino del teléfono no tuviera
// temporizadores de pantalla.
function detailLoadingTree(d) {
  const info = CARDINFO[d.slug] || {};
  const title = (d.meta && d.meta.title) || info.title || d.slug;
  const poster = (d.meta && d.meta.poster) || info.poster || "";
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ type: "Skeleton", key: "skr" + i, shape: "line", padding: 12 });
  }
  return {
    type: "Scaffold",
    every: { ms: 1000, event: "cargarSerie" },
    appBar: {
      title: title,
      leading: { type: "IconButton", key: "backHome", icon: "arrow_back",
        labelText: "Atrás", labelTextEn: "Back",
        onPressed: { event: "popBack" } },
      actions: [],
    },
    body: { type: "SingleChildScrollView", key: "detailLoading", children: [
      { type: "Column", children: [
        { type: "Row", gap: 16, padding: 16, crossAxisAlignment: "start", stackOnNarrow: true,
          children: [
            poster ? { type: "Image", url: poster, width: { compact: 120, expanded: 160 },
              aspect: "2:3", alt: title, fallback: { type: "Skeleton", shape: "block" } }
              : { type: "Skeleton", shape: "block", width: { compact: 120, expanded: 160 } },
            { type: "Column", gap: 6, flex: 2, crossAxisAlignment: "start", children: [
              { type: "Text", text: title, style: "h2" },
              { type: "Skeleton", shape: "line" },
              { type: "Skeleton", shape: "line" },
              { type: "Skeleton", shape: "line" },
              { type: "Text", text: "Cargando cómic…", textEn: "Loading comic…",
                color: "muted", style: "caption" },
              { type: "ElevatedButton", key: "loadNow", icon: "download",
                labelText: "Cargar ahora", labelTextEn: "Load now",
                onPressed: { event: "cargarSerieAhora" } },
            ] },
          ] },
        { type: "Skeleton", shape: "line", padding: 16 },
      ].concat(rows) },
    ] },
  };
}

// la sinopsis, plegada si es larga, con botón para extenderla
function sinopsisNode(state, overview) {
  const o = overview || "";
  const completa = state.sinopsisCompleta === true;
  if (o.length <= 240 || completa) {
    const children = [{ type: "Text", key: "sinopsisTxt", text: o, textEn: o, style: "p", color: "muted" }];
    if (o.length > 240) {
      children.push({ type: "TextButton", key: "sinMenos", icon: "expand_less",
        labelText: "Menos", labelTextEn: "Less", onPressed: { event: "toggleSinopsis" } });
    }
    return { type: "Column", key: "sinopsis", gap: 4, crossAxisAlignment: "start", children: children };
  }
  return { type: "Column", key: "sinopsis", gap: 4, crossAxisAlignment: "start", children: [
    { type: "Text", key: "sinopsisTxt",
      text: o.slice(0, 240).trim() + "…", textEn: o.slice(0, 240).trim() + "…",
      style: "p", color: "muted" },
    { type: "TextButton", key: "sinMas", icon: "expand_more",
      labelText: "Ver toda la sinopsis", labelTextEn: "Full synopsis",
      onPressed: { event: "toggleSinopsis" } },
  ] };
}

async function detailTree(state) {
  const d = state.detail;
  if (!d) return loadingTree();
  if (d.loading) return detailLoadingTree(d);
  const fav = isFav(d.slug);
  // la carga falló (web caída, sin red, tiempo límite agotado): se
  // ofrece reintentar en vez del cargado eterno de antes
  if (d.error) {
    return errorTree("No se pudo cargar el cómic. Comprueba tu conexión e inténtalo de nuevo.", "reloadSeries",
      { type: "ElevatedButton", icon: "arrow_back", labelText: "Volver", labelTextEn: "Back",
        onPressed: { event: "popBack" } });
  }
  // la lista de páginas vive en kino.storage, no en el estado
  const site = siteOfId(d.siteId) || siteDe(state);
  const pages = pagesDe(site, d.slug) || [];
  if (!pages.length) {
    return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: [
      { type: "Icon", name: "error", color: "muted" },
      { type: "Text", text: "No se encontraron páginas para este cómic.", textEn: "No pages found for this comic.", color: "muted" },
      { type: "ElevatedButton", icon: "refresh", labelText: "Reintentar", labelTextEn: "Retry",
        onPressed: { event: "reloadSeries" } },
      { type: "ElevatedButton", icon: "arrow_back", labelText: "Volver", labelTextEn: "Back",
        onPressed: { event: "popBack" } },
    ] };
  }
  const cover = d.meta.poster
    ? { type: "Image", url: d.meta.poster, width: { compact: 120, expanded: 160 },
        aspect: "2:3", alt: d.meta.title,
        fallback: { type: "Icon", name: "list" } }
    : { type: "Icon", name: "list" };
  const pg = progress()[d.slug];
  // botones en dos filas limpias, sin huecos (como ZonaTM0):
  //  - fila principal: Leer/Continuar a todo el ancho
  //  - fila secundaria compacta SOLO con iconos: Favoritos ·
  //    Actualizar · Olvidar lo leído (solo si hay progreso)
  const filaPrincipal = pg
    ? { type: "ElevatedButton", key: "cont", icon: "play",
        labelText: "Seguir leyendo", labelTextEn: "Continue reading",
        flex: 1, onPressed: { event: "read" } }
    : { type: "ElevatedButton", key: "start", icon: "play",
        labelText: "Leer cómic", labelTextEn: "Read comic",
        flex: 1, onPressed: { event: "read" } };
  // fila secundaria SOLO con iconos (sin texto): el labelText queda
  // como etiqueta accesible/mando de TV, no se dibuja.
  const filaSecundaria = [
    { type: "IconButton", key: "fav", icon: fav ? "heart" : "star",
      labelText: fav ? "Quitar de favoritos" : "Añadir a favoritos",
      labelTextEn: fav ? "Remove favourite" : "Add favourite",
      onPressed: "fav" },
    // Actualizar: salta el caché y trae las páginas de nuevo
    { type: "IconButton", key: "refresh", icon: "refresh",
      labelText: "Actualizar", labelTextEn: "Refresh",
      onPressed: "reloadSeries" },
  ];
  if (pg) {
    filaSecundaria.push({ type: "IconButton", key: "olvidar", icon: "delete",
      labelText: "Olvidar lo leído", labelTextEn: "Forget read progress",
      onPressed: { event: "borrarProg", arg: d.slug } });
  }
  const head = {
    type: "Row", gap: 16, padding: 16, crossAxisAlignment: "start", stackOnNarrow: true,
    children: [
      cover,
      { type: "Column", gap: 6, flex: 2, crossAxisAlignment: "start", children: [
        { type: "Text", text: d.meta.title || d.slug, style: "h2" },
        { type: "Badge", key: "adult", text: "18+" },
        d.meta.overview ? sinopsisNode(state, d.meta.overview) : null,
        pages.length ? { type: "Text", key: "npags", text: pages.length + " páginas" + (d.meta.capped ? " (mostrando las " + PAGES_MAX + " primeras)" : ""),
          textEn: pages.length + " pages", color: "muted", style: "caption" } : null,
        // fila principal — leer, sin huecos
        { type: "Row", key: "filaLeer", gap: 8, children: [filaPrincipal] },
        // fila secundaria — gestión, sin huecos
        { type: "Row", key: "filaGestion", gap: 8,
          mainAxisAlignment: "center", children: filaSecundaria },
      ].filter(Boolean) },
    ],
  };
  return {
    type: "Scaffold",
    appBar: {
      title: d.meta.title || d.slug,
      leading: { type: "IconButton", key: "backHome", icon: "arrow_back",
        labelText: "Atrás", labelTextEn: "Back",
        onPressed: { event: "popBack" } },
      actions: [],
    },
    body: { type: "SingleChildScrollView", key: "detailBody", children: [head] },
  };
}

// contador de aperturas del lector (claves únicas por apertura)
let navSeq = 0;

// Modo páginas (Kino 0.9.81, receta de MangaTrack)
function pagesDisponible() {
  try {
    return typeof kino === "object" && kino !== null &&
      typeof kino.screen === "object" && kino.screen !== null &&
      Array.isArray(kino.screen.widgets) &&
      kino.screen.widgets.indexOf("pages") >= 0;
  } catch (e) { return false; }
}

function modoLectorPref() {
  return getJson("modoLector", "tira") === "paginas" ? "paginas" : "tira";
}

function modoLectorEfectivo(n) {
  const puede = pagesDisponible() && n >= 2 && n <= 250;
  return puede && modoLectorPref() === "paginas" ? "paginas" : "tira";
}

function paginaFit(p, i, pre) {
  const k = (pre || "") + "p" + i;
  return { type: "SingleChildScrollView", key: k + "z", zoom: true, children: [
    { type: "Image", key: k, url: typeof p === "string" ? p : p.url,
      alt: "Página " + (i + 1), altEn: "Page " + (i + 1),
      fill: true, fit: "width", aspect: "2:3" } ] };
}

// barra fina SOLO para el modo páginas (no hay final de tira donde
// poner la tarjeta). Una sola fila: Volver.
function barraPaginas(r, n) {
  return {
    type: "Card", key: "panelLectura", margin: 8, padding: 8, gap: 8,
    children: [
      { type: "Row", gap: 8, children: [
        { type: "IconButton", key: "pbBack", icon: "arrow_back",
          labelText: "Volver al detalle", labelTextEn: "Back to details",
          onPressed: { event: "popBack" } },
        { type: "Text", key: "lblPos", flex: 1,
          text: "Página " + Math.min((r.pag || 0) + 1, n) + " de " + n,
          textEn: "Page " + Math.min((r.pag || 0) + 1, n) + " of " + n,
          style: "caption", color: "muted" },
      ] },
    ],
  };
}

// la ÚNICA barra de navegación del lector en modo tira — la tarjeta al
// final del cómic. «Volver al detalle» y el cambio de modo si tu Kino
// admite el modo páginas.
function finComicNode(r, modo) {
  const children = [
    { type: "Row", gap: 8, children: [
      { type: "IconButton", key: "finBack", icon: "arrow_back",
        labelText: "Volver al detalle", labelTextEn: "Back to details",
        onPressed: { event: "popBack" } },
      { type: "Text", key: "finFin",
        text: "Fin del cómic", textEn: "End of comic",
        style: "caption", color: "muted", flex: 1 },
    ] },
  ];
  if (pagesDisponible()) {
    children.push({ type: "Row", gap: 8, mainAxisAlignment: "center", children: [
      { type: "TextButton", key: "finModo",
        labelText: modo === "paginas" ? "Modo páginas" : "Modo tira",
        labelTextEn: modo === "paginas" ? "Page mode" : "Strip mode",
        onPressed: "modoLector" },
    ] });
  }
  return { type: "Card", key: "finCap", margin: 16, padding: 12, gap: 8, children: children };
}

async function readerTree(state) {
  const r = state.reader;
  if (!r) return loadingTree();
  const pages = Array.isArray(r.imgs) ? r.imgs : [];
  if (!pages.length) {
    return { type: "Column", padding: 32, gap: 12, crossAxisAlignment: "center", children: [
      { type: "Icon", name: "error", color: "muted" },
      { type: "Text", text: "No se pudieron cargar las páginas de este cómic.", textEn: "Could not load this comic's pages.", color: "muted" },
      { type: "ElevatedButton", icon: "arrow_back", labelText: "Volver", labelTextEn: "Back",
        onPressed: { event: "popBack" } },
    ] };
  }
  const chKey = String(r.slug).replace(/[^a-z0-9]/gi, "").slice(-16);
  const scrollKey = "pages-" + chKey + "-" + (r.tk || 0);
  const pre = "r" + (r.tk || 0) + "-"; // claves únicas por apertura
  const modo = modoLectorEfectivo(pages.length);
  // el lector es SIEMPRE pantalla completa (como ZonaTM0 v1.1.6) — sin
  // barra propia (queda la de Kino con Cerrar/Atrás), sin botón
  // flotante y sin panel inferior. La navegación vive en la tarjeta
  // del final.
  const body = [];
  if (modo === "paginas") {
    body.push({
      // clave única por apertura — el paginador arranca en la
      // página 1, sin restaurar la última vista.
      type: "pages", key: "pgs-" + (r.tk || 0), flex: 1, progress: "bar",
      children: pages.map((p, i) => paginaFit(p, i, pre)),
    });
    body.push(barraPaginas(r, pages.length));
  } else {
    body.push({
      type: "SingleChildScrollView", key: scrollKey, flex: 1, zoom: true,
      children: [{
        type: "Column", gap: 4, crossAxisAlignment: "center", fill: true,
        children: pages.flatMap((p, i) => pageNodes(p, i, pre))
          // la tarjeta del final es la ÚNICA barra de navegación.
          .concat([finComicNode(r, modo)]),
      }],
    });
  }
  return {
    type: "Scaffold",
    body: { type: "Column", children: body },
  };
}


async function searchTree(state) {
  const q = typeof state.resultsQ === "string" ? state.resultsQ : "";
  const results = Array.isArray(state.results) ? state.results : null;
  return {
    type: "Scaffold",
    appBar: { title: "Buscar cómic", titleEn: "Search a comic", actions: [] },
    body: {
      type: "SingleChildScrollView", key: "searchBody",
      children: [{
        type: "Column", children: [
          { type: "Form", key: "search", onSubmitted: "search", gap: 8, padding: 16, children: [
            { type: "TextField", key: "q", kind: "search", value: q,
              labelText: "Título", labelTextEn: "Title",
              hintText: "P. ej. Chloe", hintEn: "e.g. Chloe",
              required: true },
            { type: "ElevatedButton", icon: "search", labelText: "Buscar", labelTextEn: "Search", submit: true },
          ] },
          chipsRow(state),
          state.searchError
            ? filaError("No se pudo buscar. Comprueba tu conexión.", "reintentarSearch")
            : (results
              ? (results.length ? titleGridOf(results) : { type: "emptyState", icon: "search", title: "Sin resultados para «" + q + "».", titleEn: "No results." })
              : { type: "Text", text: "Escribe un título y pulsa Buscar.", textEn: "Type a title and press Search.", color: "muted", padding: 16 }),
        ].filter(Boolean),
      }],
    },
  };
}

// --------------------------------------------------------- los exports

export async function screen({ state, route }) {
  const r = route || { name: "home" };
  try {
    if (r.name === "detail") {
      const slug = routeSlug(r);
      if (!state.detail || state.detail.slug !== slug) {
        // el detalle del estado no es el de esta ruta; se pinta la
        // vista de esqueletos y el temporizador corrige el estado.
        return detailLoadingTree(detailLoadingDe(slug, state));
      }
      return await detailTree(state);
    }
    if (r.name === "read") return await readerTree(state);
    if (r.name === "search") return searchTree(state);
  } catch (e) {
    return errorTree("No se pudo cargar (" + (e.code || "error") + ").", "retry");
  }
  // ruta raíz: pestañas. Se pintan AL INSTANTE (caché o esqueletos) y
  // el temporizador «cargarRoot» trae lo que falte en segundo plano.
  return {
    type: "Scaffold",
    every: { ms: 1500, event: "cargarRoot" },
    appBar: {
      title: siteDe(state).name,
      actions: [
        { type: "IconButton", icon: "search", key: "goSearch", labelText: "Buscar", labelTextEn: "Search", onPressed: { event: "goSearch" } },
      ],
      bottom: {
        type: "TabBar", key: "tabs", tabs: TABS,
        value: state.tab || "inicio", onChanged: { event: "tab" },
      },
    },
    body: tabBody(state),
  };
}

// El detalle en carga: arranca en segundo plano y evita que dos cargas
// se pisen (temporizador + botón «Cargar ahora»).
let serieEnCarga = null;

// el cómic que se está viendo AHORA. Un tick del temporizador que
// termine de cargar un cómic anterior ya no debe sobrescribir el
// detalle: se compara contra esta variable al terminar la carga.
let slugDetalleActivo = null;

// un solo intento de carga de la raíz a la vez: si un tick tarda, los
// siguientes no se apilan (antes podían pisarse entre sí).
let rootEnCarga = false;

function detailLoadingDe(slug, state) {
  const info = CARDINFO[slug] || {};
  slugDetalleActivo = slug;
  return { slug: slug, siteId: (info && info.s) || (siteDe(state).id), loading: true,
    meta: { title: info.title || "", poster: info.poster || "" } };
}

export async function screenEvent(ev) {
  const name = ev.name;
  const state = ev.state || {};
  try {
    if (name === "open") {
      syncPull();
      const r = ev.route || {};
      if (r.name === "detail") {
        const slug = routeSlug(r);
        if (slug && slugValido(slug) && (!state.detail || state.detail.slug !== slug)) {
          return { state: { detail: detailLoadingDe(slug, state) } };
        }
      }
      // aplicar fuente predeterminada si aún no hay una en el estado
      if (!state.fuente) {
        return { state: { fuente: prefFuenteId() } };
      }
      return null;
    }
    // cambiar de fuente (chips): se limpian Inicio y Biblioteca; el
    // temporizador las vuelve a traer de la fuente nueva.
    if (name === "fuente" || name === "fuenteSel") {
      const raw = ev.value;
      const id = String(typeof raw === "string" ? raw
        : (raw && (raw.fuente || raw.value)) || ev.arg || "");
      if (!SITES.some((s) => s.id === id)) return null;
      if (siteDe(state).id === id) return null;
      return { state: { fuente: id, cats: {}, libItems: null, libPage: 1,
        libError: false, libDone: false, libLoading: false },
        toast: "Fuente: " + siteOfId(id).name };
    }
    if (name === "tab") {
      // cambiar de pestaña no espera a la red; si falta la lista, el
      // temporizador la trae.
      return { state: { tab: ev.value } };
    }
    // temporizador de la raíz: trae Inicio/Biblioteca en segundo plano
    if (name === "cargarRoot") {
      if (rootEnCarga) return null;
      const tab = state.tab || "inicio";
      const site = siteDe(state);
      if (tab === "biblioteca") {
        if (Array.isArray(state.libItems)) return null;
        rootEnCarga = true;
        try {
          const items = await fetchLibrary(site, 1);
          return { state: { libItems: items, libPage: 1, libError: false, libDone: items.length < PER_PAGE } };
        } catch (e) {
          return { state: { libError: true } };
        } finally {
          rootEnCarga = false;
        }
      }
      if (tab === "inicio") {
        // UNA sección por tick — la pantalla nunca se bloquea
        const cats = state.cats || {};
        for (const g of site.sections) {
          if (!cats[g.key] || (cats[g.key] && cats[g.key].error)) {
            rootEnCarga = true;
            let items = [], fallo = false;
            try {
              items = await getCards(site, 1, "", g);
            } catch (e) { fallo = true; } finally { rootEnCarga = false; }
            return { state: { cats: Object.assign({}, cats, { [g.key]: { items: items, page: 1, error: fallo } }) } };
          }
        }
        return null;
      }
      return null;
    }
    // reintentar una sección que falló (borra su estado; el siguiente
    // tick del temporizador la vuelve a cargar)
    if (name === "reintentarSeccion") {
      const cats = state.cats || {};
      const limpio = {};
      for (const k of Object.keys(cats)) {
        if (cats[k] && cats[k].error && !(cats[k].items || []).length) continue;
        limpio[k] = cats[k];
      }
      return { state: { cats: limpio } };
    }
    // reintentar la Biblioteca
    if (name === "reintentarLib") {
      return { state: { libError: false, libItems: null } };
    }
    // reintentar la búsqueda (repite la última consulta)
    if (name === "reintentarSearch") {
      const q = typeof state.resultsQ === "string" ? state.resultsQ : "";
      if (!q) return null;
      try {
        const results = await getCards(siteDe(state), 1, q, null);
        return { state: { results: results, searchError: false },
          toast: results.length ? results.length + " resultados" : "Sin resultados" };
      } catch (e) {
        return { state: { searchError: true }, toast: "Error de conexión. Inténtalo de nuevo." };
      }
    }
    // temporizador del detalle: carga el cómic en segundo plano
    if (name === "cargarSerie" || name === "cargarSerieAhora") {
      const d = state.detail;
      if (!d) return null;
      // autocuración — si el detalle del estado no es el que se está
      // viendo (quedó el del cómic anterior), se corrige aquí y el
      // siguiente tick lo carga.
      if (slugDetalleActivo && d.slug !== slugDetalleActivo) {
        return { state: { detail: detailLoadingDe(slugDetalleActivo, state) } };
      }
      if (!d.loading) return null;
      if (serieEnCarga === d.slug && name === "cargarSerie") return null;
      serieEnCarga = d.slug;
      slugDetalleActivo = d.slug;
      try {
        // refresh=true salta el caché (botón «Actualizar»/«Reintentar»)
        const res = await cargarDetalle(state, d.slug, d.refresh === true);
        // mientras cargaba este cómic se abrió otro — el resultado ya
        // no vale y NO se aplica.
        if (slugDetalleActivo !== d.slug) return null;
        return res;
      } finally {
        serieEnCarga = null;
      }
    }
    if (name === "libMore") {
      const page = (state.libPage || 1) + 1;
      const more = await fetchLibrary(siteDe(state), page);
      let merged = (state.libItems || []).concat(more.filter((x) => !(state.libItems || []).some((y) => y.slug === x.slug)));
      if (merged.length > LIB_MAX) merged = merged.slice(0, LIB_MAX);
      return { state: { libItems: merged, libPage: page, libDone: more.length < PER_PAGE || merged.length >= LIB_MAX } };
    }
    if (name === "goSearch") return { route: { push: "search" } };
    if (name === "pop") return { route: { pop: true } };
    if (name === "popBack") return { route: { pop: true } };
    if (name === "search") {
      const q = String(ev.value && ev.value.q || "").trim();
      if (!q) return { toast: "Escribe un título." };
      let results;
      try {
        results = await getCards(siteDe(state), 1, q, null);
      } catch (e) {
        // fallo de conexión: error VISIBLE con reintentar — nunca
        // «sin resultados», que confunde
        return { state: { searchError: true, resultsQ: q },
          toast: "Error de conexión. Inténtalo de nuevo." };
      }
      return { state: { results: results, resultsQ: q, searchError: false },
        toast: results.length ? results.length + " resultados" : "Sin resultados para «" + q + "»" };
    }
    if (name === "retry") return { state: { _r: Date.now() } };
    // «Ver más» al final de una sección — trae la página siguiente de
    // esa etiqueta y la añade a la sección.
    if (name === "verMas") {
      const key = String(ev.arg || "");
      const site = siteDe(state);
      const g = site.sections.find((x) => x.key === key);
      const cats = state.cats || {};
      const cat = cats[key];
      if (!g || !cat) return null;
      if (cat.items.length >= GENERO_MAX) return { toast: "La sección ya está completa" };
      const page = (cat.page || 1) + 1;
      try {
        const more = await getCards(site, page, "", g);
        const vistos = {};
        for (const it of cat.items) vistos[it.slug] = true;
        const nuevos = more.filter((it) => !vistos[it.slug]);
        if (!nuevos.length) return { toast: "No hay más cómics de " + g.label };
        let merged = cat.items.concat(nuevos);
        if (merged.length > GENERO_MAX) merged = merged.slice(0, GENERO_MAX);
        return { state: { cats: Object.assign({}, cats, { [key]: { items: merged, page: page } }) },
          toast: "+" + nuevos.length + " en " + g.label };
      } catch (e) {
        return { toast: "No se pudo cargar más. Inténtalo otra vez." };
      }
    }
    // plegar/desplegar la sinopsis del detalle
    if (name === "toggleSinopsis") {
      return { state: { sinopsisCompleta: state.sinopsisCompleta !== true } };
    }
    // quitar UN cómic de «Seguir leyendo»/Historial (botón «Olvidar
    // lo leído» del detalle o pulsación larga en Historial)
    if (name === "borrarProg") {
      let slug = String(ev.arg || "");
      if (!slug && state.detail) slug = state.detail.slug;
      if (!slugValido(slug)) return null;
      if (!borrarProgreso(slug)) return null;
      return { state: { _r: Date.now() },
        toast: "Quitado de «Seguir leyendo»" };
    }
    // vaciar TODO «Seguir leyendo»/Historial (dos toques para
    // confirmar; el primero solo cambia el texto del botón)
    if (name === "clearHist") {
      if (!state.confBorrar) {
        return { state: { confBorrar: true },
          toast: "Toca otra vez para borrar TODO el historial" };
      }
      borrarTodoProgreso();
      return { state: { confBorrar: false },
        toast: "Historial y «Seguir leyendo» borrados" };
    }
    // Reintentar / Actualizar en el detalle: vuelve a la vista de
    // esqueletos (sin bloquear) y el temporizador recarga saltando el
    // caché (refresh=true).
    if (name === "reloadSeries") {
      const d = state.detail;
      if (!d) return null;
      return { state: { detail: { slug: d.slug, loading: true, refresh: true,
        meta: d.meta || {} } } };
    }
    if (name === "fav") {
      const d = state.detail;
      if (!d) return null;
      const f = favs();
      const i = f.findIndex((x) => x.slug === d.slug);
      let added = false;
      if (i >= 0) f.splice(i, 1);
      else { f.unshift({ slug: d.slug, title: d.meta.title || d.slug, poster: d.meta.poster,
        s: d.siteId || siteDe(state).id,
        u: (CARDINFO[d.slug] && CARDINFO[d.slug].u) || "" }); added = true; }
      setJson("favs", f);
      syncPush("favs", f);
      return { toast: added ? "Añadido a favoritos" : "Quitado de favoritos" };
    }
    if (name === "read") {
      // abre el lector con TODAS las páginas del cómic (de kino.storage
      // o de la red). SIEMPRE desde la primera página.
      const d = state.detail;
      if (!d) return null;
      const site = siteOfId(d.siteId) || siteDe(state);
      const images = await paginasDe(site, d.slug);
      if (!images.length) return { toast: "No se encontraron páginas en este cómic." };
      const urlComic = (CARDINFO[d.slug] && CARDINFO[d.slug].u) ||
        site.base + "/" + site.comicPath + d.slug + "/";
      markRead(d.slug, d.meta.title, d.meta.poster, "Cómic", urlComic, site.id);
      const reader = { slug: d.slug, title: d.meta.title, poster: d.meta.poster,
        chUrl: urlComic, imgs: images, tk: ++navSeq };
      return { state: { reader: reader }, route: { push: "read" } };
    }
    if (name === "modoLector") {
      if (!pagesDisponible()) return null;
      const nuevo = modoLectorPref() === "paginas" ? "tira" : "paginas";
      setJson("modoLector", nuevo);
      return { state: { _r: Date.now() },
        toast: nuevo === "paginas" ? "Modo páginas" : "Modo tira" };
    }
    if (name === "openSeries") {
      const slug = String(ev.arg || "");
      if (!slugValido(slug)) return null;
      // (receta MangaTrack): el detalle se abre AL INSTANTE con
      // esqueletos; las páginas llegan por el temporizador en
      // segundo plano. La fuente del cómic: la guardada con la
      // tarjeta/favorito/historial; si no, la activa.
      const siteId = (CARDINFO[slug] && CARDINFO[slug].s) ||
        (progress()[slug] && progress()[slug].s) ||
        (favs().find((f) => f.slug === slug) || {}).s || siteDe(state).id;
      return { state: { detail: detailLoadingDe(slug, { fuente: siteId }) },
               route: { push: "detail", params: { slug: slug } } };
    }
  } catch (e) {
    return { toast: "Algo falló: " + (e.code || "error") };
  }
  return null;
}
