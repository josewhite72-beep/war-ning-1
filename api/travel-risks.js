const { XMLParser } = require('fast-xml-parser');

const FEED_URL = 'https://travel.state.gov/_res/rss/TAsTWs.xml';

// Vocabulario cerrado de motivos. Cada patrón fue verificado contra el feed real
// del 22 de septiembre de 2026 antes de subir esta función. No se inventan
// motivos fuera de esta lista.
const PATRONES_MOTIVOS = [
  ['conflicto_armado', /armed conflict/i],
  ['terrorismo', /terroris/i],
  ['crimen', /\bcrime\b/i],
  ['disturbios', /\bunrest\b/i],
  ['secuestro', /kidnap/i],
  ['minas', /land ?mine/i],
  ['salud', /\bhealth\b/i],
  ['detencion_injusta', /wrongful detention/i],
  ['desastres_naturales', /natural disaster/i]
];

function textoDe(valor) {
  // fast-xml-parser puede devolver una cadena simple, un objeto { '#text': '...' },
  // o un arreglo de un elemento con esa forma (visto en el feed real dentro de
  // bloques CDATA). Esta función normaliza los tres casos a texto plano.
  if (valor == null) return '';
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor)) return valor.map(textoDe).join(' ');
  if (typeof valor === 'object' && '#text' in valor) return String(valor['#text']);
  return String(valor);
}

function stripHtml(html) {
  return textoDe(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extraerMotivos(descripcionPlano) {
  var motivos = [];
  PATRONES_MOTIVOS.forEach(function (par) {
    if (par[1].test(descripcionPlano)) motivos.push(par[0]);
  });
  return motivos;
}

function extraerNivel(categoria) {
  var lista = Array.isArray(categoria) ? categoria : [categoria];
  for (var i = 0; i < lista.length; i++) {
    var c = lista[i];
    if (c && c['@_domain'] === 'Threat-Level') {
      var m = /Level\s+(\d)/i.exec(textoDe(c));
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

function extraerPais(tituloCompleto) {
  // El feed real puede repetir el sufijo de nivel dos veces (visto en producción
  // el 22-sep-2026 con "Israel - Level 3: Reconsider Travel - Level 3: ...");
  // nos quedamos con todo lo que hay ANTES de la primera vez que aparece " - Level".
  var idx = tituloCompleto.indexOf(' - Level');
  return idx === -1 ? tituloCompleto.trim() : tituloCompleto.slice(0, idx).trim();
}

function esEntradaCompuesta(tituloCompleto) {
  // Detectado en el feed real: las entradas que resumen varios países usan
  // literalmente la frase "See Summaries" en el título (p. ej. "Mainland China,
  // Hong Kong & Macau - See Summaries - Level 3..."). Se omiten para no duplicar
  // ni mostrar un "país" que en realidad son tres.
  return /see summaries/i.test(tituloCompleto);
}

function parsearFeed(xmlTexto) {
  var parser = new XMLParser({ ignoreAttributes: false, cdataPropName: '#text' });
  var doc = parser.parse(xmlTexto);
  var items = doc && doc.rss && doc.rss.channel && doc.rss.channel.item;
  if (!items) return [];
  if (!Array.isArray(items)) items = [items];

  var paises = [];
  items.forEach(function (item) {
    var titulo = textoDe(item.title);
    if (!titulo || esEntradaCompuesta(titulo)) return;

    var nivel = extraerNivel(item.category);
    if (nivel === null || nivel < 1 || nivel > 4) return; // dato con forma inválida, se descarta

    var pubDateTexto = textoDe(item.pubDate);
    var fecha = pubDateTexto ? new Date(pubDateTexto) : null;
    if (!fecha || isNaN(fecha.getTime())) return; // fecha inválida, se descarta

    // El feed real casi siempre da solo el día ("Tue, 08 Sep 2026"), sin hora. Si se
    // interpreta esa fecha como si tuviera hora, JavaScript asume medianoche UTC, y al
    // mostrarla en la zona horaria del lector puede saltar al día anterior. Por eso se
    // marca si el texto original SÍ traía una hora real, para no inventarla al mostrarla.
    var tieneHora = /\d{1,2}:\d{2}/.test(pubDateTexto);

    var link = textoDe(item.link);
    if (!link) return; // sin enlace a la fuente, se descarta

    var descripcionPlano = stripHtml(item.description);

    paises.push({
      country: extraerPais(titulo),
      level: nivel,
      updatedAt: fecha.toISOString(),
      updatedAtHasTime: tieneHora,
      sourceUrl: link,
      motivos: extraerMotivos(descripcionPlano),
      motivo_original: descripcionPlano.slice(0, 400)
    });
  });
  return paises;
}

// Handler de Vercel: corre en el servidor, no en el navegador del visitante,
// así que la petición a travel.state.gov no choca con la política de CORS.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate'); // 30 min, igual que el intervalo de la app

  try {
    var respuesta = await fetch(FEED_URL);
    if (!respuesta.ok) {
      res.status(502).json({ error: 'La fuente respondió con un error', status: respuesta.status });
      return;
    }
    var xmlTexto = await respuesta.text();
    var paises = parsearFeed(xmlTexto);

    if (paises.length < 50) {
      // Protección mínima: si el feed devolviera casi nada, es más probable
      // que algo esté roto que que de verdad solo haya unos pocos avisos.
      res.status(502).json({ error: 'La fuente devolvió muy pocos países válidos (' + paises.length + ')' });
      return;
    }

    res.status(200).json(paises);
  } catch (err) {
    res.status(502).json({ error: 'No se pudo recibir ni procesar la señal', detalle: String(err.message || err) });
  }
};

// Se exportan también las funciones internas, únicamente para poder probarlas
// con Node fuera de Vercel (como ya se hizo antes de entregar este archivo).
module.exports.parsearFeed = parsearFeed;
module.exports.extraerMotivos = extraerMotivos;
