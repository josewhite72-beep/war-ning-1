const Papa = require('papaparse');

// --- Vocabulario de tipos de violencia ---
// Verificado contra fuentes independientes (Davies et al.; codebook UCDP), no adivinado:
// 1 = conflicto armado estatal, 2 = conflicto no estatal, 3 = violencia unilateral contra civiles.
var TIPOS = { 1: 'conflicto_estatal', 2: 'conflicto_no_estatal', 3: 'violencia_unilateral' };

// --- Cálculo de la dirección del CSV mensual, sin escribirla a mano ---
// El archivo de UCDP Candidate se publica una vez al mes, con nombre GEDEvent_v{YY}_0_{M}.csv
// (confirmado contra los archivos reales de julio y agosto de 2026). Se prueba el mes actual
// y, si todavía no existe, los 2 anteriores: la fuente avisa que su publicación puede tardar
// "hasta un mes", así que a veces el mes en curso aún no tiene archivo.
function candidatosMensuales(fecha, intentos) {
  intentos = intentos || 3;
  var urls = [];
  var y = fecha.getUTCFullYear();
  var m = fecha.getUTCMonth() + 1;
  for (var i = 0; i < intentos; i++) {
    var yy = String(y % 100).padStart(2, '0');
    urls.push('https://ucdp.uu.se/downloads/candidateged/GEDEvent_v' + yy + '_0_' + m + '.csv');
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return urls;
}

// --- Transformación de cada fila a nuestro formato ---
// Deliberadamente NO se incluyen: nombres de actores, texto de la noticia, nombre del medio,
// ni el nombre del pueblo/barrio exacto. Solo fecha, tipo, país, región y muertes reportadas.
function transformarFila(fila) {
  var tipo = TIPOS[fila.type_of_violence];
  if (!tipo) return null; // valor fuera del vocabulario conocido: se descarta, no se adivina

  var fecha = fila.date_start;
  if (!fecha || isNaN(Date.parse(fecha))) return null;

  var pais = (fila.country || '').trim();
  if (!pais) return null;

  var region = (fila.adm_1 || '').trim();
  var lugar = region ? (region + ', ' + pais) : pais;

  var muertes = parseInt(fila.best, 10);
  if (isNaN(muertes) || muertes < 0) muertes = null;

  return {
    fecha: fecha.slice(0, 10),
    tipo: tipo,
    pais: pais,
    lugar: lugar,
    muertes_reportadas: muertes
  };
}

function transformarCsv(textoCsv, limite) {
  var parsed = Papa.parse(textoCsv, { header: true, skipEmptyLines: true });
  var eventos = [];
  parsed.data.forEach(function (fila) {
    var t = transformarFila(fila);
    if (t) eventos.push(t);
  });
  eventos.sort(function (a, b) { return b.fecha.localeCompare(a.fecha); });
  if (limite) eventos = eventos.slice(0, limite);
  return { eventos: eventos, filasLeidas: parsed.data.length };
}

var LIMITE_EVENTOS = 500; // tope de fila enviadas al navegador; el buscador ya filtra sobre esto

async function descargarPrimeraDisponible(urls) {
  for (var i = 0; i < urls.length; i++) {
    try {
      var r = await fetch(urls[i]);
      if (r.ok) {
        var texto = await r.text();
        return { texto: texto, url: urls[i] };
      }
      console.log('No disponible aún (' + r.status + '): ' + urls[i]);
    } catch (err) {
      console.error('Fallo al intentar ' + urls[i] + ':', err);
    }
  }
  return null;
}

// Handler de Vercel: corre en el servidor, no en el navegador del visitante.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate'); // 6h: el dato es mensual, no hace falta más seguido

  try {
    var candidatos = candidatosMensuales(new Date());
    var descarga = await descargarPrimeraDisponible(candidatos);

    if (!descarga) {
      res.status(502).json({ error: 'No se encontró un archivo mensual disponible de UCDP en los últimos 3 meses' });
      return;
    }

    var resultado = transformarCsv(descarga.texto, LIMITE_EVENTOS);
    console.log('UCDP: usado ' + descarga.url + ' · filas leídas: ' + resultado.filasLeidas +
      ' · eventos entregados: ' + resultado.eventos.length);

    if (resultado.eventos.length === 0) {
      res.status(502).json({ error: 'El archivo de UCDP no contenía eventos válidos' });
      return;
    }

    res.status(200).json({
      generado: new Date().toISOString().slice(0, 10),
      fuente: {
        id: 'ucdp-candidate',
        nombre: 'UCDP Candidate Events Dataset',
        url: 'https://ucdp.uu.se/downloads/candidateged/',
        nota: 'Datos mensuales preliminares (hasta 1 mes de rezago). Licencia CC BY 4.0 — ' +
          'Davies, Pettersson & Öberg (2026), Journal of Peace Research; Hegre et al. (2020), Research & Politics.'
      },
      eventos: resultado.eventos
    });
  } catch (err) {
    res.status(502).json({ error: 'No se pudo recibir ni procesar la señal', detalle: String(err.message || err) });
  }
};

module.exports.candidatosMensuales = candidatosMensuales;
module.exports.transformarFila = transformarFila;
module.exports.transformarCsv = transformarCsv;
