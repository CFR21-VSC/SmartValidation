/* ====================================================================
   VALIDATION SUITE — RENDERER DE PRUEBA
   Solo se usa para verificar que la portada + control/aprobaciones
   funcionan correctamente. Eliminar cuando los renderers reales esten
   en su lugar.
   ==================================================================== */

(function (global) {
    'use strict';

    const VS = global.ValidationSuite;
    if (!VS) return;

    VS.registerRenderer('TEST', function renderTest(data) {
        const tb = VS.templateBase;
        return [
            {
                text: '1. CONTENIDO DE PRUEBA',
                fontSize: 14,
                bold: true,
                color: tb.VS_COLORS.primary,
                margin: [0, 0, 0, 4]
            },
            {
                canvas: [{ type: 'line', x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 1, lineColor: tb.VS_COLORS.primary }],
                margin: [0, 0, 0, 12]
            },
            {
                text: 'Este es un renderer de prueba. Si ves la portada y la pagina de Control de Cambios + Matriz de Aprobaciones correctamente, el motor base funciona.',
                fontSize: 10,
                margin: [0, 0, 0, 12]
            },
            {
                text: 'La matriz de aprobaciones del fixture de prueba tiene 6 firmantes (4 estandar + 2 del cliente) para verificar que el sistema soporta N firmantes sin tope.',
                fontSize: 10,
                italics: true,
                color: tb.VS_COLORS.textSoft
            }
        ];
    });

    // Helpers para invocar pruebas desde la consola del navegador:
    //     ValidationSuite.testWithFixture()         — fixture base de portada/aprobaciones
    //     ValidationSuite.testHLRA()                — fixture HLRA completo (modelo DRP-SIS-001)
    VS.testWithFixture = async function () {
        const resp = await fetch('js/validation-suite/test-fixture.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testHLRA = async function () {
        const resp = await fetch('js/validation-suite/fixtures/hlra-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testVP = async function () {
        const resp = await fetch('js/validation-suite/fixtures/vp-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testURS = async function () {
        const resp = await fetch('js/validation-suite/fixtures/urs-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testFRS = async function () {
        const resp = await fetch('js/validation-suite/fixtures/frs-lims-medicorp.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testDS = async function () {
        const resp = await fetch('js/validation-suite/fixtures/ds-lims-medicorp.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testRA = async function () {
        const resp = await fetch('js/validation-suite/fixtures/ra-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testIRA = async function () {
        const resp = await fetch('js/validation-suite/fixtures/ira-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testRRM = async function () {
        const resp = await fetch('js/validation-suite/fixtures/rrm-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testMTR = async function () {
        const resp = await fetch('js/validation-suite/fixtures/mtr-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testPIQ = async function () {
        const resp = await fetch('js/validation-suite/fixtures/piq-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testIIQ = async function () {
        const resp = await fetch('js/validation-suite/fixtures/iiq-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testIOQ = async function () {
        const resp = await fetch('js/validation-suite/fixtures/ioq-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testPPQ = async function () {
        const resp = await fetch('js/validation-suite/fixtures/ppq-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

    VS.testIPQ = async function () {
        const resp = await fetch('js/validation-suite/fixtures/ipq-drp-sis-001.json');
        const data = await resp.json();
        return VS.renderDocument(data, { download: true });
    };

})(window);
