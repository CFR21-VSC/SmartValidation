"""
Matriz de cumplimiento regulatorio GxP.
Mapea los requisitos normativos aplicables al paquete de validación
contra los documentos presentes.

Normativas cubiertas:
  ANMAT Disposición 4159/2023 Anexo VI       (Argentina)
  GAMP 5 2da Edición (ISPE)                  (industria global)
  ICH Q9 R1                                  (gestión de riesgos)
  21 CFR Part 11 (FDA)                       (registros electrónicos EE.UU.)
  EU GMP Annex 11 (EMA)                      (sistemas informatizados UE)
  PIC/S PI 011-3                             (sistemas informatizados internacional)
"""

from typing import Any
from .models import RegRequirement

# ── Definición de requisitos normativos ──────────────────────────────────────
# docs_required : TODOS deben estar presentes → satisfied
# docs_any      : AL MENOS UNO debe estar presente → satisfied
# severity      : gravedad si no se cumple (CRITICO / MAYOR / MENOR)

_REQS = [

    # ════════════════════════════════════════════════════════════════════════
    # ANMAT Disposición 4159/2023 — Anexo VI
    # ════════════════════════════════════════════════════════════════════════
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §1',
        'requirement': 'Alcance y justificación de aplicación: el documento define a qué sistemas aplica y por qué',
        'docs_required': ['vp'],
        'docs_any':   [],
        'severity':   'MAYOR',
        'gap_msg':    'El VP debe incluir el alcance del sistema y la justificación de aplicación de la Disposición 4159/2023.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §3',
        'requirement': 'Plan de Validación (VP) como documento rector del ciclo, firmado y aprobado',
        'docs_required': ['vp'],
        'docs_any':   [],
        'severity':   'CRITICO',
        'gap_msg':    'El VP es el documento rector obligatorio. Sin él, el ciclo carece de alcance, criterios de aceptación y asignación de responsabilidades.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §4.1',
        'requirement': 'Especificación de Requerimientos de Usuario (URS) formalmente documentada y aprobada',
        'docs_required': ['urs'],
        'docs_any':   [],
        'severity':   'CRITICO',
        'gap_msg':    'El URS es la base de toda la trazabilidad. Su ausencia impide verificar que el sistema cumple con los requerimientos del negocio y del usuario.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §4.2',
        'requirement': 'Especificación de Requerimientos Funcionales (FRS) para sistemas GAMP 4/5',
        'docs_required': [],
        'docs_any':   ['frs'],
        'severity':   'MENOR',
        'gap_msg':    'El FRS es requerido para sistemas GAMP 4 (configurables) y GAMP 5 (a medida). Para GAMP 3 puede omitirse con justificación explícita en el VP.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §4.3',
        'requirement': 'Especificación de Diseño del Sistema (DS) para sistemas GAMP 4/5',
        'docs_required': [],
        'docs_any':   ['ds'],
        'severity':   'MENOR',
        'gap_msg':    'El DS documenta la arquitectura técnica y las configuraciones. Requerido para GAMP 4/5; puede omitirse para GAMP 3 con justificación en el VP.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §5.1',
        'requirement': 'Análisis de Riesgo de Alto Nivel (HLRA) documentado como fundamento del ciclo',
        'docs_required': [],
        'docs_any':   ['hlra', 'ra', 'ira'],
        'severity':   'CRITICO',
        'gap_msg':    'Al menos un documento de análisis de riesgo debe existir y ser aprobado antes del inicio de los protocolos de calificación.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §5.2',
        'requirement': 'Análisis de Riesgo detallado (RA) con evaluación de controles y mitigaciones',
        'docs_required': ['ra'],
        'docs_any':   [],
        'severity':   'CRITICO',
        'gap_msg':    'El RA debe identificar, evaluar y proponer controles para cada riesgo identificado sobre los requerimientos del URS.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §5.3',
        'requirement': 'Registro de Riesgo Residual (RRM) post-aplicación de controles',
        'docs_required': [],
        'docs_any':   ['rrm'],
        'severity':   'MENOR',
        'gap_msg':    'El RRM documenta los riesgos que permanecen tras la aplicación de controles y su aceptabilidad para el uso GxP.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §5.4',
        'requirement': 'Análisis de Riesgo de Componentes (IRA) para sistemas con múltiples módulos',
        'docs_required': [],
        'docs_any':   ['ira'],
        'severity':   'MENOR',
        'gap_msg':    'El IRA es recomendado cuando el sistema tiene múltiples componentes o módulos con riesgos diferenciados por instalación.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §6.1 IQ',
        'requirement': 'Protocolo de Calificación de Instalación (IQ) — documenta que el sistema se instaló correctamente',
        'docs_required': [],
        'docs_any':   ['piq', 'iiq', 'riq'],
        'severity':   'CRITICO',
        'gap_msg':    'La IQ es obligatoria para todos los sistemas informatizados. Falta al menos uno de: PIQ (protocolo), IIQ (informe), RIQ (reporte de decisión).',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §6.2 OQ',
        'requirement': 'Protocolo de Calificación Operacional (OQ) — verifica el funcionamiento bajo condiciones operacionales',
        'docs_required': [],
        'docs_any':   ['poq', 'ioq', 'roq'],
        'severity':   'MAYOR',
        'gap_msg':    'La OQ verifica que el sistema opera correctamente dentro de los parámetros de diseño. Puede omitirse sólo para sistemas GAMP 3 con IRO bajo y justificación explícita en el VP.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §6.3 PQ',
        'requirement': 'Protocolo de Calificación de Desempeño (PQ) cuando el sistema tiene métricas de performance GxP críticas',
        'docs_required': [],
        'docs_any':   ['ppq', 'ipq', 'rpq'],
        'severity':   'MENOR',
        'gap_msg':    'La PQ aplica cuando el sistema tiene métricas de desempeño críticas para la calidad (ej. tiempos de proceso, capacidad de lotes). No requerida para GAMP 3 sin requisitos de performance.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §6.4',
        'requirement': 'Informe de ejecución o Reporte de Decisión por cada protocolo de calificación',
        'docs_required': [],
        'docs_any':   ['iiq', 'ioq', 'ipq', 'riq', 'roq', 'rpq'],
        'severity':   'MAYOR',
        'gap_msg':    'Cada protocolo ejecutado debe tener su informe/reporte de cierre. Sin cierre formal, el protocolo no puede considerarse completado ni el sistema declarado calificado.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §7',
        'requirement': 'Matriz de Trazabilidad (MTR) que relacione cada URS con sus casos de prueba',
        'docs_required': ['mtr'],
        'docs_any':   [],
        'severity':   'MAYOR',
        'gap_msg':    'La MTR es la evidencia documentada de cobertura completa de requerimientos. Su ausencia es una No Conformidad mayor en cualquier auditoría regulatoria.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §8',
        'requirement': 'Informe Final de Validación / Reporte de Decisión de Sistema (VSR) que cierra el ciclo',
        'docs_required': [],
        'docs_any':   ['vsr'],
        'severity':   'CRITICO',
        'gap_msg':    'El VSR cierra formalmente el ciclo de validación y declara el sistema apto para uso GxP. Sin él, el sistema no puede considerarse validado bajo la disposición.',
    },
    {
        'regulation': 'ANMAT 4159/2023',
        'article':    'Anexo VI §9',
        'requirement': 'Gestión de No Conformidades y Desviaciones documentada (NCR)',
        'docs_required': [],
        'docs_any':   ['ncr'],
        'severity':   'MENOR',
        'gap_msg':    'Las desviaciones y no conformidades detectadas durante el ciclo deben documentarse en NCRs. Un ciclo sin NCR puede ser observado en auditoría como "demasiado limpio" o no representativo.',
    },

    # ════════════════════════════════════════════════════════════════════════
    # GAMP 5 2da Edición (ISPE)
    # ════════════════════════════════════════════════════════════════════════
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 3 §3.1',
        'requirement': 'Categorización GAMP del sistema (1/3/4/5) documentada y justificada',
        'docs_required': ['hlra'],
        'docs_any':   [],
        'severity':   'CRITICO',
        'gap_msg':    'Sin HLRA no hay categorización GAMP documentada. La categoría GAMP determina el alcance documental completo del ciclo.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 4 §4.3',
        'requirement': 'Ciclo de vida documentado: desde el HLRA hasta el VSR, con cada etapa trazable',
        'docs_required': [],
        'docs_any':   ['vp', 'vsr'],
        'severity':   'MAYOR',
        'gap_msg':    'El VP y el VSR son los delimitadores del ciclo de vida. Sin ambos, el ciclo no tiene inicio ni cierre formales.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 5 §5.2',
        'requirement': 'Risk assessment con identificación, análisis y evaluación de riesgos para la calidad',
        'docs_required': ['ra'],
        'docs_any':   [],
        'severity':   'CRITICO',
        'gap_msg':    'El RA con criterios S×P×D es el fundamento del testing basado en riesgo. Su ausencia invalida la justificación del alcance de todos los protocolos.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 5 §5.3',
        'requirement': 'Análisis de Riesgo de Componentes (IRA) para sistemas GAMP 4/5',
        'docs_required': [],
        'docs_any':   ['ira'],
        'severity':   'MENOR',
        'gap_msg':    'El IRA descompone el riesgo a nivel de componente. Recomendado para GAMP 4/5; puede omitirse para GAMP 3.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 5 §5.4',
        'requirement': 'Risk control: controles implementados y riesgo residual documentado (RRM)',
        'docs_required': [],
        'docs_any':   ['rrm'],
        'severity':   'MENOR',
        'gap_msg':    'El RRM cierra el ciclo de gestión de riesgos documentando los riesgos residuales aceptados.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 6 §6.1',
        'requirement': 'Especificación de requerimientos funcionales y de diseño para sistemas GAMP 4/5',
        'docs_required': [],
        'docs_any':   ['frs', 'ds'],
        'severity':   'MENOR',
        'gap_msg':    'FRS y DS son requeridos para GAMP 4/5. Para GAMP 3, el URS es suficiente con justificación.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 8 §8.1',
        'requirement': 'Testing basado en riesgo con trazabilidad URS→TC documentada en protocolos',
        'docs_required': [],
        'docs_any':   ['piq', 'poq', 'ppq'],
        'severity':   'CRITICO',
        'gap_msg':    'Sin protocolos de calificación no existe evidencia de testing. Es el núcleo operativo del enfoque GAMP 5.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 8 §8.2',
        'requirement': 'Matriz de Trazabilidad (MTR) que demuestre cobertura de todos los requerimientos',
        'docs_required': ['mtr'],
        'docs_any':   [],
        'severity':   'MAYOR',
        'gap_msg':    'La MTR es la evidencia de que el testing cubre todos los requerimientos del URS según el enfoque risk-based de GAMP 5.',
    },
    {
        'regulation': 'GAMP 5 2da Ed.',
        'article':    'Cap. 9 §9.1',
        'requirement': 'Informe Final de Validación (VSR) con declaración de estado validado del sistema',
        'docs_required': [],
        'docs_any':   ['vsr'],
        'severity':   'CRITICO',
        'gap_msg':    'El VSR declara el sistema apto para uso GxP y es el entregable final del enfoque GAMP 5.',
    },

    # ════════════════════════════════════════════════════════════════════════
    # ICH Q9 R1 — Gestión de Riesgos para la Calidad
    # ════════════════════════════════════════════════════════════════════════
    {
        'regulation': 'ICH Q9 R1',
        'article':    '§4',
        'requirement': 'Proceso de gestión de riesgos formalmente documentado e integrado al ciclo de vida',
        'docs_required': [],
        'docs_any':   ['hlra', 'ra'],
        'severity':   'CRITICO',
        'gap_msg':    'ICH Q9 R1 exige que el ciclo tenga un proceso de risk management documentado que justifique las decisiones de testing y alcance.',
    },
    {
        'regulation': 'ICH Q9 R1',
        'article':    '§5.1',
        'requirement': 'Risk identification: identificación sistemática de peligros y sus causas raíz',
        'docs_required': [],
        'docs_any':   ['hlra', 'ra'],
        'severity':   'MAYOR',
        'gap_msg':    'El análisis de riesgo debe incluir identificación explícita de peligros, no sólo evaluación numérica.',
    },
    {
        'regulation': 'ICH Q9 R1',
        'article':    '§5.2',
        'requirement': 'Risk analysis: cuantificación de riesgo con criterios de Severidad, Probabilidad y Detectabilidad',
        'docs_required': ['ra'],
        'docs_any':   [],
        'severity':   'CRITICO',
        'gap_msg':    'El RA debe incluir análisis cuantitativo (S×P×D o equivalente). Sin análisis formal, no puede justificarse el nivel de testing.',
    },
    {
        'regulation': 'ICH Q9 R1',
        'article':    '§5.3',
        'requirement': 'Risk control: medidas de mitigación y controles documentados por cada riesgo identificado',
        'docs_required': ['ra'],
        'docs_any':   [],
        'severity':   'MAYOR',
        'gap_msg':    'Cada riesgo en el RA debe tener su medida de control documentada. Sin controles, el risk control no puede ser verificado.',
    },
    {
        'regulation': 'ICH Q9 R1',
        'article':    '§5.4',
        'requirement': 'Risk review: evaluación del riesgo residual al cierre del ciclo de validación',
        'docs_required': [],
        'docs_any':   ['rrm', 'vsr'],
        'severity':   'MENOR',
        'gap_msg':    'El VSR o el RRM deben incluir una revisión del riesgo residual post-ejecución para confirmar aceptabilidad.',
    },
    {
        'regulation': 'ICH Q9 R1',
        'article':    '§6',
        'requirement': 'Risk communication: documentación que comunique el riesgo residual a las partes interesadas',
        'docs_required': [],
        'docs_any':   ['vsr'],
        'severity':   'MENOR',
        'gap_msg':    'El VSR debe comunicar el estado final del riesgo residual y la declaración de aceptabilidad para uso GxP.',
    },

    # ════════════════════════════════════════════════════════════════════════
    # 21 CFR Part 11 (FDA) — Electronic Records / Electronic Signatures
    # ════════════════════════════════════════════════════════════════════════
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(a)',
        'requirement': 'Validación del sistema para garantizar exactitud, confiabilidad y rendimiento consistente',
        'docs_required': [],
        'docs_any':   ['vp', 'piq', 'poq', 'mtr', 'vsr'],
        'severity':   'CRITICO',
        'gap_msg':    'FDA exige que los sistemas que manejan registros electrónicos GxP sean validados. El ciclo IQ+OQ+MTR+VSR es la evidencia de validación para inspectores FDA.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(b)',
        'requirement': 'Capacidad de generar copias exactas y completas de registros en formato humano legible o electrónico',
        'docs_required': [],
        'docs_any':   ['urs', 'poq'],
        'severity':   'MAYOR',
        'gap_msg':    'El URS debe incluir el requisito de generación de copias exactas de registros, y el OQ debe verificar esa capacidad.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(c)',
        'requirement': 'Protección de registros para garantizar su exactitud y disponibilidad durante el período de retención',
        'docs_required': [],
        'docs_any':   ['urs', 'vsr'],
        'severity':   'MAYOR',
        'gap_msg':    'El URS debe documentar los requisitos de retención y protección de registros electrónicos.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(d)',
        'requirement': 'Limitación de acceso al sistema a personas autorizadas mediante controles de acceso verificados',
        'docs_required': [],
        'docs_any':   ['urs', 'piq'],
        'severity':   'MAYOR',
        'gap_msg':    'El control de acceso debe estar documentado como requisito en el URS y verificado durante el IQ. Es un punto de inspección crítico FDA.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(e)',
        'requirement': 'Audit trail generado por el sistema: usuario, fecha/hora, acción, valor anterior y posterior',
        'docs_required': [],
        'docs_any':   ['urs', 'poq'],
        'severity':   'CRITICO',
        'gap_msg':    'El audit trail automático es el requisito más inspeccionado por FDA. Debe estar en el URS como requisito no funcional y verificado en el OQ. Su ausencia o deficiencia es una 483 observation directa.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(f)',
        'requirement': 'Verificación operacional del sistema: checks de secuencia y mandatorios',
        'docs_required': [],
        'docs_any':   ['poq'],
        'severity':   'MENOR',
        'gap_msg':    'El OQ debe verificar los controles operacionales del sistema (validaciones de campos, controles de flujo) requeridos por el §11.10(f).',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(g)',
        'requirement': 'Authority checks: verificación de autorización antes de realizar operaciones críticas',
        'docs_required': [],
        'docs_any':   ['urs', 'poq'],
        'severity':   'MAYOR',
        'gap_msg':    'Los authority checks (perfiles de usuario, roles, aprobaciones) deben estar en el URS y verificados en el OQ.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.10(j)',
        'requirement': 'Políticas documentadas sobre responsabilidad de firmas electrónicas y consecuencias de uso indebido',
        'docs_required': [],
        'docs_any':   ['vp', 'urs'],
        'severity':   'MAYOR',
        'gap_msg':    'El VP o el URS deben incluir las políticas de uso de firmas electrónicas, responsabilidades y consecuencias de uso no autorizado.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.50',
        'requirement': 'Cada firma electrónica debe incluir nombre del firmante, fecha/hora y significado (rol)',
        'docs_required': [],
        'docs_any':   ['piq', 'poq', 'vsr'],
        'severity':   'MAYOR',
        'gap_msg':    'Los documentos firmados electrónicamente deben incluir nombre, fecha/hora y el significado de la firma (Ejecutor, Revisor, Aprobador). Verificar en el sistema de firma.',
    },
    {
        'regulation': '21 CFR Part 11',
        'article':    '§11.70',
        'requirement': 'Vinculación firma-registro: la firma debe estar ligada al documento de forma que no pueda transferirse',
        'docs_required': [],
        'docs_any':   ['vsr'],
        'severity':   'MENOR',
        'gap_msg':    'La firma electrónica debe estar técnicamente vinculada al documento firmado. Verificar que el sistema de firma cumpla este requisito técnico.',
    },

    # ════════════════════════════════════════════════════════════════════════
    # EU GMP Annex 11 (EMA) — Computerised Systems
    # ════════════════════════════════════════════════════════════════════════
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§1 — Gestión de Riesgos',
        'requirement': 'Gestión de riesgos aplicada a lo largo del ciclo de vida del sistema informatizado',
        'docs_required': [],
        'docs_any':   ['hlra', 'ra'],
        'severity':   'CRITICO',
        'gap_msg':    'Annex 11 §1 requiere que el risk management sea la base de todas las decisiones de validación. Sin RA documentado, no puede cumplirse este requisito.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§4.1 — Documentación de validación',
        'requirement': 'Documentación de validación completa que cubra todo el ciclo de vida del sistema',
        'docs_required': [],
        'docs_any':   ['vp', 'vsr'],
        'severity':   'CRITICO',
        'gap_msg':    'Annex 11 §4.1 exige documentación que cubra desde la especificación hasta el informe final. VP y VSR son sus delimitadores.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§4.3 — Software estándar (GAMP 3)',
        'requirement': 'Para software estándar: evidencia de adecuación mediante IQ+OQ y evaluación de proveedor',
        'docs_required': [],
        'docs_any':   ['piq', 'poq'],
        'severity':   'CRITICO',
        'gap_msg':    'Annex 11 §4.3 exige evidencia de testing incluso para software estándar. Faltan protocolos IQ y/u OQ.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§4.4 — Software no estándar (GAMP 4/5)',
        'requirement': 'Para software configurable o a medida: ciclo de vida completo con FRS, DS, testing y revisión de código',
        'docs_required': [],
        'docs_any':   ['frs', 'ds'],
        'severity':   'MENOR',
        'gap_msg':    'Para sistemas GAMP 4 o 5, Annex 11 §4.4 exige especificaciones más detalladas (FRS/DS). Si el sistema es GAMP 3, documentar esta exclusión en el VP.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§5 — Datos e integridad de datos',
        'requirement': 'Integridad de datos (ALCOA+): exactitud, legibilidad, contemporaneidad, originalidad y atribuibilidad',
        'docs_required': [],
        'docs_any':   ['urs', 'poq'],
        'severity':   'CRITICO',
        'gap_msg':    'Los principios ALCOA+ deben estar como requisito en el URS y verificados en el OQ. La integridad de datos es el foco principal de inspecciones EMA post-2016.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§7 — Almacenamiento de datos',
        'requirement': 'Verificación de la capacidad de almacenamiento y accesibilidad de datos durante el período de retención',
        'docs_required': [],
        'docs_any':   ['urs', 'piq'],
        'severity':   'MAYOR',
        'gap_msg':    'Los requisitos de almacenamiento y retención deben estar en el URS y verificados en el IQ.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§9 — Audit trail',
        'requirement': 'Audit trail automático GMP que registre cambios en datos críticos con usuario, fecha/hora y valores anterior/posterior',
        'docs_required': [],
        'docs_any':   ['urs', 'poq'],
        'severity':   'CRITICO',
        'gap_msg':    'El audit trail GMP es uno de los requisitos más inspeccionados por EMA. Debe estar en el URS como requisito y verificado en el OQ.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§10 — Gestión de cambios',
        'requirement': 'Procedimiento de gestión de cambios documentado para modificaciones post-validación',
        'docs_required': [],
        'docs_any':   ['ncr', 'vsr'],
        'severity':   'MAYOR',
        'gap_msg':    'El VSR debe incluir los criterios que triggean una revalidación, y el NCR documenta los cambios ocurridos durante el ciclo.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§11 — Evaluación periódica',
        'requirement': 'Evaluación periódica que confirme que el sistema permanece en estado validado',
        'docs_required': [],
        'docs_any':   ['vsr'],
        'severity':   'MENOR',
        'gap_msg':    'El VSR debe indicar la periodicidad de revalidación y los criterios para triggear una evaluación del estado validado.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§12 — Seguridad',
        'requirement': 'Controles de acceso físico y lógico documentados y verificados',
        'docs_required': [],
        'docs_any':   ['urs', 'piq'],
        'severity':   'MAYOR',
        'gap_msg':    'Los controles de acceso deben estar como requisito en el URS y verificados durante el IQ. Es un punto crítico en inspecciones EMA.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§14 — Firma electrónica',
        'requirement': 'Firma electrónica equivalente a la manuscrita con controles de autenticidad e identidad',
        'docs_required': [],
        'docs_any':   ['piq', 'poq', 'vsr'],
        'severity':   'MAYOR',
        'gap_msg':    'Las firmas electrónicas en documentos GMP deben cumplir Annex 11 §14. Verificar que el sistema de firma incluya autenticación de identidad y registro de rol.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§16 — Continuidad del negocio',
        'requirement': 'Plan de continuidad de negocio documentado ante fallos del sistema informatizado',
        'docs_required': [],
        'docs_any':   ['urs', 'vsr'],
        'severity':   'MENOR',
        'gap_msg':    'El URS debe incluir requisitos de continuidad/contingencia, y el VSR debe confirmar que están implementados.',
    },
    {
        'regulation': 'EU GMP Annex 11',
        'article':    '§17 — Archivado',
        'requirement': 'Plan de archivo de registros electrónicos en formato legible durante el período regulatorio reglamentario',
        'docs_required': [],
        'docs_any':   ['vsr'],
        'severity':   'MAYOR',
        'gap_msg':    'El VSR debe incluir o referenciar el plan de archivo y retención de todos los registros electrónicos generados por el sistema.',
    },

    # ════════════════════════════════════════════════════════════════════════
    # PIC/S PI 011-3 — Good Practices for Computerised Systems in GXP Environments
    # ════════════════════════════════════════════════════════════════════════
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 4 §4.1',
        'requirement': 'Documentación del ciclo de vida: sistema de gestión documental para el ciclo completo',
        'docs_required': [],
        'docs_any':   ['vp', 'vsr'],
        'severity':   'CRITICO',
        'gap_msg':    'PIC/S exige documentación completa del ciclo de vida, desde el plan hasta el informe final, con control de versiones.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 4 §4.2',
        'requirement': 'Especificación de usuario, funcional y de diseño documentadas según la categoría del sistema',
        'docs_required': ['urs'],
        'docs_any':   [],
        'severity':   'CRITICO',
        'gap_msg':    'PIC/S requiere al menos el URS para todos los sistemas. FRS y DS son requeridos para sistemas más complejos.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 5 §5.1',
        'requirement': 'Gestión de riesgos integrada al ciclo de vida del sistema informatizado',
        'docs_required': [],
        'docs_any':   ['hlra', 'ra'],
        'severity':   'CRITICO',
        'gap_msg':    'PIC/S PI 011 requiere un enfoque de risk management documentado que justifique el alcance y la profundidad de la validación.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 7 §7.1',
        'requirement': 'Validación documentada con protocolos de testing y evidencia de ejecución',
        'docs_required': [],
        'docs_any':   ['piq', 'poq', 'mtr'],
        'severity':   'CRITICO',
        'gap_msg':    'PIC/S exige protocolos ejecutados con trazabilidad a los requerimientos. Sin IQ+OQ ni MTR, la validación no puede considerarse completa.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 9 §9.1',
        'requirement': 'Control de acceso físico y lógico documentado y verificado en el sistema',
        'docs_required': [],
        'docs_any':   ['urs', 'piq'],
        'severity':   'MAYOR',
        'gap_msg':    'Los controles de acceso deben estar documentados como requisito y verificados durante la calificación de instalación.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 11 §11.1',
        'requirement': 'Audit trail automático que registre acciones de usuarios en datos críticos GxP',
        'docs_required': [],
        'docs_any':   ['urs', 'poq'],
        'severity':   'MAYOR',
        'gap_msg':    'PIC/S exige audit trail para datos críticos. El OQ debe verificar su correcto funcionamiento.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 12 §12.1',
        'requirement': 'Control de cambios post-validación documentado con evaluación de impacto regulatorio',
        'docs_required': [],
        'docs_any':   ['ncr'],
        'severity':   'MAYOR',
        'gap_msg':    'PIC/S requiere que cualquier cambio al sistema validado siga un procedimiento formal con evaluación de impacto en la validación.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 13 §13.1',
        'requirement': 'Plan de backup y contingencia documentado y verificado',
        'docs_required': [],
        'docs_any':   ['urs', 'vsr'],
        'severity':   'MENOR',
        'gap_msg':    'Los requisitos de backup y plan de contingencia deben estar en el URS y confirmados en el VSR como implementados.',
    },
    {
        'regulation': 'PIC/S PI 011-3',
        'article':    'Ch. 14 §14.1',
        'requirement': 'Informe Final de Validación (VSR) con declaración formal del estado validado del sistema',
        'docs_required': [],
        'docs_any':   ['vsr'],
        'severity':   'CRITICO',
        'gap_msg':    'El VSR es el documento que declara formalmente el sistema apto para uso GxP bajo PIC/S. Sin él, el ciclo no tiene cierre.',
    },
]


def build_reg_matrix(documents: dict[str, Any]) -> list[RegRequirement]:
    """
    Evalúa cada requisito normativo contra los documentos presentes en el paquete.
    Devuelve una lista ordenada por normativa y artículo.
    """
    present_types = {k.lower() for k in documents if documents.get(k)}
    result: list[RegRequirement] = []

    for req in _REQS:
        required = req['docs_required']
        any_of   = req['docs_any']

        if required:
            present   = [d for d in required if d in present_types]
            satisfied = len(present) == len(required)
        else:
            present   = [d for d in any_of if d in present_types]
            satisfied = bool(present)

        result.append(RegRequirement(
            regulation   = req['regulation'],
            article      = req['article'],
            requirement  = req['requirement'],
            docsRequired = required if required else any_of,
            docsAny      = any_of if not required else [],
            docsPresent  = present,
            satisfied    = satisfied,
            severity     = req['severity'],
            gap          = '' if satisfied else req['gap_msg'],
        ))

    return result
