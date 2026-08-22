'use strict';

/* ====================================================================
   AI GENERATOR — SKILL LOADER
   Carga los archivos .md de claude-desktop-skills/ y construye
   el system prompt para cada tipo de documento.
   ==================================================================== */

(function (global) {
    const VS = global.ValidationSuite = global.ValidationSuite || {};
    VS.AIGenerator = VS.AIGenerator || {};

    const SKILLS_BASE = 'claude-desktop-skills/';
    const LESSONS_FILE = '_LECCIONES-APRENDIDAS.md';

    // Cache en memoria para evitar re-fetchear en la misma sesión
    const _cache = Object.create(null);

    const SkillLoader = {

        // ── Loaders individuales ──────────────────────────────────────

        async loadSkill(docType) {
            const filename = docType + '-generator.md';
            if (_cache[filename] !== undefined) return _cache[filename];
            const r = await fetch(SKILLS_BASE + filename);
            if (r.ok) {
                const text = await r.text();
                if (!text || !text.trim()) throw new Error(`Skill vacío: ${filename}`);
                _cache[filename] = text;
                return text;
            }
            // Fallback: para tipos con sufijo de módulo (poq-mod01, iiq-mod02…)
            // extrae el tipo base y usa su skill file
            const dashIdx = docType.indexOf('-');
            if (dashIdx > 0) {
                const baseType = docType.slice(0, dashIdx);
                const baseName = baseType + '-generator.md';
                if (_cache[baseName] !== undefined) return _cache[baseName];
                const rb = await fetch(SKILLS_BASE + baseName);
                if (rb.ok) {
                    const text = await rb.text();
                    if (text && text.trim()) {
                        _cache[baseName] = text;
                        _cache[filename] = text; // alias para evitar re-fetch
                        return text;
                    }
                }
            }
            throw new Error(`Skill no encontrado: ${filename} (HTTP ${r.status})`);
        },

        async loadLessonsLearned() {
            if (_cache[LESSONS_FILE] !== undefined) return _cache[LESSONS_FILE];
            try {
                const r = await fetch(SKILLS_BASE + LESSONS_FILE);
                if (!r.ok) {
                    _cache[LESSONS_FILE] = '';
                    return '';
                }
                const text = await r.text();
                _cache[LESSONS_FILE] = text || '';
                return _cache[LESSONS_FILE];
            } catch (_) {
                _cache[LESSONS_FILE] = '';
                return '';
            }
        },

        // ── Builder principal ─────────────────────────────────────────

        async buildSystemPrompt(docType) {
            const [skill, lessons] = await Promise.all([
                this.loadSkill(docType),
                this.loadLessonsLearned()
            ]);
            if (lessons && lessons.trim()) {
                return skill + '\n\n---\n\n# LECCIONES APRENDIDAS\n\n' + lessons;
            }
            return skill;
        },

        // ── Utilidades ────────────────────────────────────────────────

        clearCache() {
            Object.keys(_cache).forEach(k => delete _cache[k]);
        },

        // Retorna una copia del cache (solo para tests)
        _getCacheSnapshot() {
            return { ..._cache };
        }
    };

    VS.AIGenerator.SkillLoader = SkillLoader;

})(typeof window !== 'undefined' ? window : global);
