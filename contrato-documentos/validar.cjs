// Validador del contrato de documentos v3.0 — sin dependencias.
//
//   node contrato-documentos/validar.cjs <esqueleto.json> <instancia.json> [...]
//   node contrato-documentos/validar.cjs --demo        (corre los ejemplos incluidos)
//
// Sale con codigo != 0 si alguna instancia tiene errores.
// NO modifica archivos ni migra documentos.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const leer = p => JSON.parse(fs.readFileSync(p, 'utf8'));

/** Valor semantico de una celda: el texto, venga como string o como celda rica. */
function valorSemantico(c) {
  if (c && typeof c === 'object' && !Array.isArray(c)) return String(c.text != null ? c.text : '').trim();
  return String(c == null ? '' : c).trim();
}
const esAgrupacion = f => f && typeof f === 'object' && !Array.isArray(f) && f.subheader != null;
const esFilaDatos  = f => Array.isArray(f) ? f.some(c => valorSemantico(c) !== '') : (!esAgrupacion(f) && f && typeof f === 'object');

function validar(esqueleto, inst, nombre) {
  const E = [];   // errores
  const W = [];   // advertencias
  const err = (regla, msg) => E.push({ regla, msg });
  const adv = (regla, msg) => W.push({ regla, msg });

  const secs = Array.isArray(inst.secciones) ? inst.secciones : [];
  const porId = new Map();
  const defSkel = new Map((esqueleto.secciones || []).map(s => [s.id, s]));

  // ── 1. Identidad del documento ──────────────────────────────────────────
  const campoTipo = (esqueleto.compatibilidad || {}).campoTipoEnInstancia || 'type';
  if (inst[campoTipo] !== esqueleto.tipoDocumento)
    err('identidad', `instancia.${campoTipo}="${inst[campoTipo]}" != esqueleto.tipoDocumento="${esqueleto.tipoDocumento}"`);
  if (!inst.esqueleto || inst.esqueleto.version !== esqueleto.contrato)
    err('identidad', `la instancia debe referenciar el esqueleto ${esqueleto.contrato} (trae ${JSON.stringify(inst.esqueleto)})`);
  // El esqueleto referenciado debe ser el del MISMO tipo de documento.
  if (inst.esqueleto && inst.esqueleto.tipo && inst.esqueleto.tipo !== esqueleto.tipoDocumento)
    err('identidad', `la instancia referencia el esqueleto "${inst.esqueleto.tipo}" pero se valida contra "${esqueleto.tipoDocumento}"`);
  if (inst.obligatoriedad || (inst.secciones || []).some(s => s.obligatoriedad !== undefined))
    err('autoridad', 'la instancia no puede declarar `obligatoriedad`: es potestad exclusiva del esqueleto');

  // ── 2. Reglas de arbol ───────────────────────────────────────────────────
  secs.forEach((s, i) => {
    if (!s.id) { err('arbol', `seccion #${i + 1} sin id`); return; }
    if (porId.has(s.id)) err('arbol', `id duplicado: "${s.id}"`);
    porId.set(s.id, s);
    if (!['seccion', 'bloque'].includes(s.clase)) err('arbol', `"${s.id}": clase invalida (${s.clase})`);
  });
  secs.forEach(s => {
    if (!s.id) return;
    if (s.padre === s.id) err('arbol', `"${s.id}": autorreferencia en padre`);
    if (s.clase === 'bloque' && !s.padre) err('arbol', `"${s.id}": clase bloque sin padre`);
    if (s.padre) {
      const p = porId.get(s.padre);
      if (!p) err('arbol', `"${s.id}": padre inexistente "${s.padre}"`);
      else if (p.clase !== 'seccion') err('arbol', `"${s.id}": el padre "${s.padre}" no es clase seccion`);
    }
  });
  // ciclos
  secs.forEach(s => {
    const visto = new Set(); let cur = s;
    while (cur && cur.padre) {
      if (visto.has(cur.id)) { err('arbol', `ciclo de padres que involucra a "${s.id}"`); break; }
      visto.add(cur.id); cur = porId.get(cur.padre);
    }
  });

  // ── 3. Numeracion ────────────────────────────────────────────────────────
  secs.forEach(s => {
    if (typeof s.numero === 'string') {
      err('numeracion', `"${s.id}": numero como string ("${s.numero}") — rechazado en contrato 3.0`);
    }
  });

  // ── 3bis. Conformidad con lo que declara el esqueleto ────────────────────
  // El esqueleto es la autoridad sobre tipo y parentesco de cada seccion: la
  // instancia no puede redefinirlos. Cubre "tipo inexistente" y "padre
  // semanticamente incorrecto" sin necesidad de una lista aparte de tipos.
  secs.forEach(s => {
    const ds = defSkel.get(s.id);
    if (!ds) return;
    // Ausencia y discrepancia son la misma falta: el renderer despacha por
    // `tipo`, asi que una seccion sin tipo no se dibuja. Antes `ds.tipo && s.tipo`
    // solo miraba la discrepancia y dejaba pasar la ausencia.
    if (ds.tipo && !s.tipo)
      err('tipo', `"${s.id}": falta el campo tipo (el esqueleto declara "${ds.tipo}")`);
    else if (ds.tipo && s.tipo && s.tipo !== ds.tipo)
      err('tipo', `"${s.id}": tipo "${s.tipo}" no coincide con el del esqueleto ("${ds.tipo}")`);
    const padreEsq = ds.padre || null;
    const padreInst = s.padre || null;
    if (padreEsq !== padreInst)
      err('parentesco', `"${s.id}": padre "${padreInst}" no coincide con el del esqueleto ("${padreEsq}")`);
    if (ds.clase && s.clase && s.clase !== ds.clase)
      err('clase', `"${s.id}": clase "${s.clase}" no coincide con la del esqueleto ("${ds.clase}")`);
  });
  // Secciones presentes en la instancia que el esqueleto no declara.
  secs.forEach(s => {
    if (s.id && !defSkel.has(s.id))
      err('desconocida', `"${s.id}": la seccion no esta declarada en el esqueleto`);
  });

  // ── 3ter. Secciones requeridas no pueden estar vacias ────────────────────
  // "Tiene contenido" no puede medirse por longitud de array: `bloques: [{}]`
  // es un array de largo 1 que no dibuja nada, y asi un documento en borrador
  // pasaba por completo. Se mide si queda algo LEGIBLE al aplanar.
  const hayTextoUtil = (v, prof = 0) => {
    if (v == null || prof > 6) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number' || typeof v === 'boolean') return true;
    if (Array.isArray(v)) return v.some(x => hayTextoUtil(x, prof + 1));
    if (typeof v === 'object') {
      // Un nodo que solo dibuja (canvas, imagen, salto) cuenta como contenido.
      if (v.canvas || v.image || v.svg || v.pageBreak) return true;
      return Object.values(v).some(x => hayTextoUtil(x, prof + 1));
    }
    return false;
  };
  const tieneContenido = (s) => {
    if ((s.filas || []).some(f => hayTextoUtil(f))) return true;
    return ['bloques', 'texto', 'contenido', 'parrafos', 'incluido', 'excluido',
            'preguntas', 'intro', 'firmas', 'rolesPlaceholder'].some(k => hayTextoUtil(s[k]));
  };
  // Una seccion contenedora ("5. CONTEXTO DEL SISTEMA") esta vacia en si misma
  // y sin embargo no lo esta: su contenido vive en los hijos. Mirar solo la
  // seccion daba falsos positivos sobre documentos reales y correctos.
  const hijosDe = new Map();
  secs.forEach(s => {
    if (!s.padre) return;
    if (!hijosDe.has(s.padre)) hijosDe.set(s.padre, []);
    hijosDe.get(s.padre).push(s);
  });
  const tieneContenidoConHijos = (s, visto = new Set()) => {
    if (!s || visto.has(s.id)) return false;
    visto.add(s.id);
    if (tieneContenido(s)) return true;
    return (hijosDe.get(s.id) || []).some(h => tieneContenidoConHijos(h, visto));
  };
  (esqueleto.secciones || []).forEach(ds => {
    if (ds.obligatoriedad !== 'requerida') return;
    const s = porId.get(ds.id);
    if (!s || s.noAplica) return;                 // ya se reporta en el bloque 4
    if (!tieneContenidoConHijos(s))
      err('vacia', `"${ds.id}" es requerida y no tiene contenido (ni en sus hijos)`);
  });

  // ── 4. Obligatoriedad y estados ──────────────────────────────────────────
  (esqueleto.secciones || []).forEach(ds => {
    if (ds.obligatoriedad !== 'requerida') return;
    const s = porId.get(ds.id);
    if (!s) { err('obligatoriedad', `falta la seccion requerida "${ds.id}"`); return; }
    if (s.noAplica) err('obligatoriedad', `"${ds.id}" es requerida: no admite noAplica`);
  });
  secs.forEach(s => {
    if (!s.noAplica) return;
    const ds = defSkel.get(s.id);
    if (ds && ds.admiteNoAplica === false) err('noAplica', `"${s.id}" no admite noAplica segun el esqueleto`);
    if (!s.noAplica.justificacion || !String(s.noAplica.justificacion).trim())
      err('noAplica', `"${s.id}": noAplica requiere justificacion no vacia`);
    if ((s.filas || []).length) err('noAplica', `"${s.id}": noAplica incompatible con filas activas`);
  });

  // ── 5. Forma de instancia (compatibilidad con los extractores) ───────────
  secs.forEach(s => {
    const ds = defSkel.get(s.id); if (!ds || !ds.tabla) return;
    if (s.tabla && s.tabla.filas) err('forma', `"${s.id}": las filas deben vivir en sec.filas, nunca en sec.tabla.filas (los extractores leen sec.filas)`);
    const tieneId = (ds.tabla.columnas || []).some(c => c.rol === 'idDefinicion');
    (s.filas || []).forEach((f, j) => {
      if (esAgrupacion(f)) {
        if (!ds.tabla.permiteAgrupacion) err('forma', `"${s.id}" fila ${j}: agrupacion no permitida en esta tabla`);
        return;
      }
      if (tieneId && !Array.isArray(f))
        err('forma', `"${s.id}" fila ${j}: tabla con ID requiere filas array (tracer descarta filas no-array)`);
      if (tieneId && f && typeof f === 'object' && !Array.isArray(f)) {
        const v = f.ursId != null ? f.ursId : f.id;
        if (v && typeof v === 'object') err('forma', `"${s.id}" fila ${j}: ID rico en fila-objeto — coherence_pack hace str() y no matchea`);
      }
    });
  });

  // ── 6. Columnas, IDs, enums, minFilasDatos ───────────────────────────────
  const idsVistos = new Map();
  const canonVistos = new Map();   // forma canonica del ID -> como se escribio
  // El contrato 3.1 declara VARIANTES de columnas: la misma tabla puede venir
  // con dos formas legitimas ("Responsabilidad en este URS" con 2 columnas, o
  // "Rol / Nombre / Responsabilidad principal" con 3). Se elige la variante que
  // coincide con la instancia y se valida contra ELLA, con sus propios roles.
  const normLabel = x => String(x == null ? '' : x).normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const variantePara = (ds, s) => {
    const vs = ds.tabla.variantes;
    if (!vs) return { cols: ds.tabla.columnas || [], err: null };
    const inst = (s.columnas || []).map(normLabel);
    const v = vs.find(x => (x.columnas || []).map(c => normLabel(c.label)).join('|') === inst.join('|'));
    if (v) return { cols: v.columnas, err: null };
    return { cols: [], err: `"${s.id}": las columnas ${JSON.stringify(s.columnas)} no coinciden con ` +
      `ninguna de las ${vs.length} variantes que declara el contrato` };
  };

  secs.forEach(s => {
    const ds = defSkel.get(s.id); if (!ds || !ds.tabla) return;
    // Una seccion declarada noAplica no tiene filas por definicion: exigirle
    // minFilasDatos o celdas requeridas seria un falso positivo. Que el
    // noAplica sea legitimo ya lo juzga el bloque 4.
    if (s.noAplica) return;
    const elegida = variantePara(ds, s);
    if (elegida.err) { err('columnas', elegida.err); return; }
    const cols = elegida.cols;

    if (!ds.tabla.sinColumnas) {
      if (!Array.isArray(s.columnas)) {
        err('columnas', `"${s.id}": el contrato declara ${cols.length} columnas y la instancia no trae "columnas"`);
      } else if (s.columnas.length !== cols.length) {
        err('columnas', `"${s.id}": ${s.columnas.length} columnas en la instancia vs ${cols.length} en el contrato`);
      } else {
        // Las etiquetas tambien importan: una columna renombrada cambia el
        // significado de la tabla y rompe a quien la lea por encabezado.
        cols.forEach((c, k) => {
          if (c.label == null) return;
          if (String(s.columnas[k]).trim() !== String(c.label).trim())
            err('columnas', `"${s.id}" columna ${k}: "${s.columnas[k]}" != "${c.label}" del contrato`);
        });
      }
    }

    const filas = s.filas || [];
    const datos = filas.filter(f => !esAgrupacion(f) && esFilaDatos(f));
    if (datos.length < (ds.tabla.minFilasDatos || 0))
      err('minFilas', `"${s.id}": ${datos.length} filas de datos < minimo ${ds.tabla.minFilasDatos} (las agrupaciones no cuentan)`);

    // Una fila mas corta que el contrato no "falta un dato": corre todas las
    // columnas siguientes un lugar, asi que el enunciado pasa a leerse como
    // tipo y la criticidad queda vacia. El contenido cambia en silencio.
    if (cols.length && !ds.tabla.sinColumnas) {
      datos.forEach((f, j) => {
        if (!Array.isArray(f)) return;
        if (f.length !== cols.length)
          err('arity', `"${s.id}" fila ${j}: ${f.length} celdas contra ${cols.length} columnas del contrato`);
      });
    }

    cols.forEach((c, k) => {
      if (!c.rol && !c.enum && !c.requerido) return;
      datos.forEach((f, j) => {
        if (!Array.isArray(f)) return;
        const v = valorSemantico(f[k]);
        if (c.requerido && !v) err('celda', `"${s.id}" fila ${j} col "${c.key}": valor requerido vacio`);
        if (c.enum && v && !c.enum.includes(v)) err('enum', `"${s.id}" fila ${j} col "${c.key}": "${v}" fuera de [${c.enum.join(', ')}]`);
        if (c.rol === 'idDefinicion' && v) {
          const pat = ((esqueleto.idPolicy || {}).patrones || {})[c.idClase];
          if (pat && !new RegExp(pat).test(v)) err('id', `"${s.id}" fila ${j}: "${v}" no matchea ${pat}`);
          if (((esqueleto.idPolicy || {}).prohibidos || []).includes(v)) err('id', `"${s.id}" fila ${j}: "${v}" esta prohibido`);
          // La secuencia arranca en 1: cualquier cantidad de digitos en cero es
          // invalida. Listar "URS-000" no alcanzaba, porque el patron admite
          // 3 o 4 digitos y dejaba pasar "URS-0000".
          const mNum = v.match(/(\d+)$/);
          if (mNum && Number(mNum[1]) === 0)
            err('id', `"${s.id}" fila ${j}: "${v}" — la numeracion de IDs arranca en 1`);
          if (idsVistos.has(v)) err('id', `ID duplicado "${v}" (${idsVistos.get(v)} y ${s.id})`);
          else idsVistos.set(v, s.id);
          // URS-0001 es otra forma de escribir URS-001. El patron admite 3 o 4
          // digitos —para que URS-1000 sea posible sin invalidar los URS-001 ya
          // firmados—, asi que ambas grafias pasan y quedan como dos identidades
          // donde hay una. Quien trace por texto ve dos; quien trace por numero,
          // una. Se exige UNA representacion: ceros a la izquierda solo hasta el
          // ancho minimo.
          const ancho = (esqueleto.idPolicy || {}).anchoMinimo;
          const mDig = v.match(/(\d+)$/);
          if (ancho && mDig) {
            const canon = String(Number(mDig[1])).padStart(ancho, '0');
            if (mDig[1] !== canon)
              err('id', `"${v}" no esta en forma canonica: ${mDig[1]} deberia escribirse ${canon} (ancho minimo ${ancho})`);
          }
          // Y la misma identidad no puede aparecer con dos grafias distintas.
          const clave = v.replace(/(\d+)$/, (_, d) => String(Number(d)));
          if (canonVistos.has(clave) && canonVistos.get(clave) !== v)
            err('id', `"${v}" y "${canonVistos.get(clave)}" son la misma identidad escrita distinto`);
          else canonVistos.set(clave, v);
        }
      });
    });

    // Celdas ricas declaradas que llegaron aplanadas: senal de perdida en el round-trip
    cols.forEach((c, k) => {
      if (c.celda !== 'rica') return;
      const aplanadas = datos.filter(f => Array.isArray(f) && typeof f[k] === 'string' && f[k] !== '').length;
      if (aplanadas && aplanadas === datos.length && datos.length > 2)
        adv('celdaRica', `"${s.id}" col "${c.key}": ${aplanadas} celdas declaradas ricas llegaron como string (posible aplanado previo)`);
    });
  });

  // ── 7. Resumen derivado: coherencia con requirementsSummary ──────────────
  // El esqueleto declara el mapeo; aca solo se verifica que los valores sean
  // numeros no negativos y que coincidan con lo que dice la seccion derivada.
  // El esqueleto declara la forma exigida en `resumenRequerido`, tomada del
  // skill generador (claude-desktop-skills/urs-generator.md), que es la
  // autoridad: es el contrato con el que se escriben los documentos. No se
  // infiere de ninguna muestra.
  const specRs = esqueleto.resumenRequerido;
  const rs = inst.requirementsSummary;
  if (specRs && specRs.obligatorio && (rs === undefined || rs === null))
    err('resumen', `falta requirementsSummary (el generador lo declara obligatorio con ${(specRs.campos || []).length} campos)`);
  if (rs !== undefined) {
    if (typeof rs !== 'object' || rs === null || Array.isArray(rs)) {
      err('resumen', 'requirementsSummary debe ser un objeto');
    } else {
      if (specRs) {
        (specRs.campos || []).forEach(c => {
          if (!(c.nombre in rs)) { err('resumen', `requirementsSummary.${c.nombre}: campo exigido ausente`); return; }
          const v = rs[c.nombre];
          if (c.tipo === 'entero' && (typeof v !== 'number' || !Number.isInteger(v) || v < 0))
            err('resumen', `requirementsSummary.${c.nombre} = ${JSON.stringify(v)}: debe ser un entero >= 0`);
          if (c.tipo === 'listaIds' && !Array.isArray(v))
            err('resumen', `requirementsSummary.${c.nombre}: debe ser un array de IDs`);
        });
        // El resumen tiene que coincidir con los DATOS, no solo consigo mismo.
        // Con todos los contadores en cero y las dos listas vacias, las sumas y
        // las longitudes cerraban y el documento pasaba con 55 IDs en la tabla.
        const der = (specRs.derivado || {}).campos || {};
        const colDe = (idSec, key) => {
          const ds2 = defSkel.get(idSec);
          if (!ds2 || !ds2.tabla) return -1;
          const sec2 = porId.get(idSec);
          const cs = ds2.tabla.variantes ? (variantePara(ds2, sec2 || {}).cols || [])
                                         : (ds2.tabla.columnas || []);
          return cs.findIndex(c => c.key === key);
        };
        const filasDe = idSec => {
          const sec = porId.get(idSec);
          if (!sec) return [];
          return (sec.filas || []).filter(f => Array.isArray(f) && !esAgrupacion(f) && esFilaDatos(f));
        };
        const recalcular = (d) => {
          if (d.modo === 'conteoFilas')
            return d.secciones.reduce((a, s) => a + filasDe(s).length, 0);
          if (d.modo === 'conteoValor')
            return d.secciones.reduce((a, s) => {
              const k = colDe(s, d.col);
              if (k < 0) return a;
              return a + filasDe(s).filter(f => valorSemantico(f[k]) === d.valor).length;
            }, 0);
          if (d.modo === 'listaValores')
            return d.secciones.flatMap(s => {
              const k = colDe(s, d.col);
              return k < 0 ? [] : filasDe(s).map(f => valorSemantico(f[k]));
            });
          return null;
        };
        Object.entries(der).forEach(([campo, d]) => {
          if (!d || !d.secciones || !(campo in rs)) return;
          const esperado = recalcular(d);
          if (esperado == null) return;
          if (Array.isArray(esperado)) {
            if (!Array.isArray(rs[campo])) return;         // ya se reporto el tipo
            const faltan = esperado.filter(x => !rs[campo].includes(x));
            const sobran = rs[campo].filter(x => !esperado.includes(x));
            if (faltan.length || sobran.length)
              err('resumen', `requirementsSummary.${campo} no coincide con la tabla: ` +
                  `${faltan.length} ID(s) de la tabla que faltan${faltan.length ? ` (${faltan.slice(0, 3).join(', ')}…)` : ''}, ` +
                  `${sobran.length} listado(s) que no estan en la tabla${sobran.length ? ` (${sobran.slice(0, 3).join(', ')}…)` : ''}`);
          } else if (typeof rs[campo] === 'number' && rs[campo] !== esperado) {
            err('resumen', `requirementsSummary.${campo} = ${rs[campo]} pero recontando las filas da ${esperado}`);
          }
        });

        // Coherencia interna declarada por el generador: el total es la suma, y
        // cada lista de IDs tiene tantos elementos como dice su contador.
        (specRs.sumas || []).forEach(({ total, partes }) => {
          if (typeof rs[total] !== 'number') return;
          const ps = partes.map(p => rs[p]).filter(x => typeof x === 'number');
          if (ps.length !== partes.length) return;
          const suma = ps.reduce((a, b) => a + b, 0);
          if (rs[total] !== suma)
            err('resumen', `requirementsSummary.${total} = ${rs[total]} pero ${partes.join(' + ')} = ${suma}`);
        });
        (specRs.listas || []).forEach(({ lista, contador }) => {
          if (!Array.isArray(rs[lista]) || typeof rs[contador] !== 'number') return;
          if (rs[lista].length !== rs[contador])
            err('resumen', `requirementsSummary.${lista} tiene ${rs[lista].length} IDs pero ${contador} = ${rs[contador]}`);
        });
      }
      Object.entries(rs).forEach(([k, v]) => {
        if (typeof v === 'number' && (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)))
          err('resumen', `requirementsSummary.${k} = ${v}: debe ser un entero >= 0`);
      });
      const dsResumen = (esqueleto.secciones || []).find(x => x.derivado && x.derivado.consistencia);
      const mapeo = dsResumen ? (dsResumen.derivado.consistencia.mapeo || {}) : {};
      const contarDatos = (idSec) => {
        const sec = porId.get(idSec);
        if (!sec) return null;
        return (sec.filas || []).filter(f => !esAgrupacion(f) && esFilaDatos(f)).length;
      };
      Object.entries(mapeo).forEach(([salida, clave]) => {
        if (!(clave in rs)) return;
        let esperado = null;
        if (salida === 'totalFuncionales') esperado = contarDatos('requerimientos-funcionales');
        if (salida === 'totalNoFuncionales') esperado = contarDatos('requerimientos-no-funcionales');
        if (esperado != null && typeof rs[clave] === 'number' && rs[clave] !== esperado)
          err('resumen', `requirementsSummary.${clave} = ${rs[clave]} pero la seccion tiene ${esperado} filas de datos`);
      });
    }
  }

  return { nombre, errores: E, advertencias: W, ids: idsVistos.size };
}

// ── CLI ────────────────────────────────────────────────────────────────────
// La expectativa (aceptar o rechazar) es un dato del caso, NO se deduce del
// nombre del archivo: un archivo valido que se llamara "…invalida.json" habria
// pasado el test sin validar nada.
//
// El codigo de salida es lo unico que mira una automatizacion. Tres defectos
// reportados en la Ronda 9, los tres reproducidos:
//   1. el uso manual imprimia los errores y salia 0: un documento RECHAZADO se
//      daba por valido aguas abajo;
//   2. un argumento suelto salia 0 sin validar nada;
//   3. la demo omitia en silencio los casos cuyo archivo no existiera
//      (.filter(existsSync)), asi que borrar un ejemplo dejaba el test en verde.
let casos = [];
let huboError = false;
const args = process.argv.slice(2);

if (!args.length || args[0] === '--demo') {
  casos = [
    { skel: 'contrato-documentos/urs.skeleton.v3.json', inst: 'contrato-documentos/ejemplos/urs.instancia.valida.json',   espera: 'acepta'  },
    { skel: 'contrato-documentos/urs.skeleton.v3.json', inst: 'contrato-documentos/ejemplos/urs.instancia.invalida.json', espera: 'rechaza' },
    { skel: 'contrato-documentos/vp.skeleton.v3.json',  inst: 'contrato-documentos/ejemplos/vp.instancia.valida.json',    espera: 'acepta'  },
  ];
  // Un caso que no se puede correr es una falla del test, no un caso menos.
  for (const c of casos) {
    for (const f of [c.skel, c.inst]) {
      if (!fs.existsSync(path.join(RAIZ, f))) {
        console.log(`FALLA DEL TEST: falta el archivo del caso: ${f}`);
        huboError = true;
      }
    }
  }
  casos = casos.filter(c => [c.skel, c.inst].every(f => fs.existsSync(path.join(RAIZ, f))));
} else {
  if (args.length % 2 !== 0) {
    console.log('USO: validar.cjs <esqueleto.json> <instancia.json> [<esqueleto> <instancia> ...]');
    console.log(`     se recibieron ${args.length} argumento(s): sobra o falta uno.`);
    process.exit(2);
  }
  // Uso manual: sin expectativa declarada, pero cualquier error debe salir != 0.
  for (let i = 0; i < args.length; i += 2) casos.push({ skel: args[i], inst: args[i + 1], espera: null });
}
for (const { skel: skelP, inst: instP, espera } of casos) {
  const skel = leer(path.isAbsolute(skelP) ? skelP : path.join(RAIZ, skelP));
  const inst = leer(path.isAbsolute(instP) ? instP : path.join(RAIZ, instP));
  const r = validar(skel, inst, path.basename(instP));

  console.log(`\n── ${r.nombre}  (esqueleto ${skel.tipoDocumento} v${skel.contrato})`);
  console.log(`   secciones: ${(inst.secciones || []).length} · IDs definidos: ${r.ids}`);
  if (!r.errores.length) console.log('   ERRORES: ninguno');
  else {
    console.log(`   ERRORES: ${r.errores.length}`);
    r.errores.slice(0, 12).forEach(e => console.log(`     [${e.regla}] ${e.msg}`));
    if (r.errores.length > 12) console.log(`     … y ${r.errores.length - 12} mas`);
  }
  r.advertencias.slice(0, 5).forEach(w => console.log(`   aviso [${w.regla}] ${w.msg}`));

  if (espera === 'rechaza') {
    if (!r.errores.length) { console.log('   >> FALLA DEL TEST: se esperaba RECHAZO y no hubo errores'); huboError = true; }
    else console.log('   >> OK: rechazada, como declara el caso');
  } else if (espera === 'acepta') {
    if (r.errores.length) { console.log('   >> FALLA DEL TEST: se esperaba ACEPTACION'); huboError = true; }
    else console.log('   >> OK: aceptada, como declara el caso');
  } else if (r.errores.length) {
    // Uso manual: la instancia fue rechazada. Salir 0 aca dejaba que una
    // automatizacion tomara por bueno un documento invalido.
    console.log('   >> RECHAZADA');
    huboError = true;
  }
}
if (huboError) process.exitCode = 1;
