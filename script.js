document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generate-btn');
    const fullScreenBtn = document.getElementById('fullscreen-btn');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    const ganttWrapper = document.getElementById('gantt-wrapper');
    const inputTbody = document.getElementById('input-tbody');
    const emptyState = document.getElementById('empty-state');
    const tableWrapper = document.getElementById('table-wrapper');
    const timelineHeader = document.getElementById('timeline-header');
    const ganttTbody = document.getElementById('gantt-tbody');
    const themeSelector = document.getElementById('theme-selector');

    if (themeSelector) {
        const VALID_THEMES = ['light', 'dark', 'corporate', 'red', 'forest', 'navy'];
        const savedTheme = VALID_THEMES.includes(localStorage.getItem('ganttTheme'))
            ? localStorage.getItem('ganttTheme')
            : 'light';
        themeSelector.value = savedTheme;
        document.body.setAttribute('data-theme', savedTheme);

        themeSelector.addEventListener('change', (e) => {
            const t = e.target.value;
            document.body.setAttribute('data-theme', t);
            localStorage.setItem('ganttTheme', t);
        });
    }

    // Restore editable header from localStorage
    const editableHeader = document.getElementById('editable-column-name');
    if (editableHeader) {
        const savedHeader = localStorage.getItem('ganttColumnHeader');
        if (savedHeader) editableHeader.innerText = savedHeader;
        editableHeader.addEventListener('input', () => {
            localStorage.setItem('ganttColumnHeader', editableHeader.innerText);
        });
    }

    // Restore toggle states from localStorage
    const TOGGLE_IDS = ['toggle-percent', 'toggle-legend', 'toggle-months', 'toggle-quarters', 'toggle-semesters', 'toggle-years', 'toggle-dates', 'toggle-cylindrical'];
    TOGGLE_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const saved = localStorage.getItem(id);
        if (saved !== null) {
            el.checked = saved === 'true';
        }
    });

    // Legend toggle — applies immediately without re-render
    const toggleLegend = document.getElementById('toggle-legend');
    function applyLegendVisibility() {
        const mainLegend = document.getElementById('main-legend');
        if (!mainLegend) return;
        if (toggleLegend && !toggleLegend.checked) {
            mainLegend.style.display = 'none';
        }
        // When checked, only show if chart is already rendered
        if (toggleLegend && toggleLegend.checked && tableWrapper.style.display !== 'none') {
            mainLegend.style.display = 'flex';
        }
    }
    if (toggleLegend) {
        toggleLegend.addEventListener('change', () => {
            localStorage.setItem('toggle-legend', toggleLegend.checked);
            applyLegendVisibility();
        });
    }

    // Re-render on toggle change if chart is already visible
    ['toggle-percent', 'toggle-months', 'toggle-quarters', 'toggle-semesters', 'toggle-years', 'toggle-dates', 'toggle-cylindrical'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                localStorage.setItem(id, el.checked);
                if (chartDeliverablesCache.length > 0 && tableWrapper.style.display !== 'none') {
                    generateBtn.click();
                }
            });
        }
    });

    const DAY_MS = 24 * 60 * 60 * 1000;

    let chartDeliverablesCache = [];
    let barColors = JSON.parse(localStorage.getItem('ganttBarColors') || '{}');

    function parseDate(dateStr) {
        if (dateStr === undefined || dateStr === null || String(dateStr).trim() === '') return null;
        if (typeof dateStr === 'string') dateStr = dateStr.trim();

        let asNum = Number(dateStr);
        if (!isNaN(asNum) && dateStr !== "") {
            if (asNum < 1000) return new Date(2021, 0, 1); // Autocompletar cuando ponen "1" u otros números pequeños que no son seriales útiles
            const d = new Date(Date.UTC(1899, 11, 30));
            d.setUTCDate(d.getUTCDate() + asNum);
            return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        }

        const parts = String(dateStr).split('/');
        if (parts.length === 3) {
            let d = parseInt(parts[0], 10);
            let m = parseInt(parts[1], 10) - 1;
            let y = parseInt(parts[2], 10);
            if (y < 100) y += 2000;
            const date = new Date(y, m, d, 0, 0, 0); // Strict local midnight
            if (!isNaN(date)) return date;
        }
        return new Date(2021, 0, 1); // Autocompletar basura textual con 1/1/2021
    }

    function parsePercent(val) {
        if (val === null || val === undefined) return null;
        const trimmed = val.toString().trim();
        if (trimmed === '') return null;
        let numStr = trimmed.replace('%', '').replace(',', '.');
        let num = parseFloat(numStr);
        return isNaN(num) ? null : Math.max(0, Math.min(100, num));
    }

    function getDaysBetween(d1, d2) {
        if (!d1 || !d2) return 0;
        const u1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
        const u2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
        return Math.round((u2 - u1) / DAY_MS); // Fixed with Math.round to avoid float truncations
    }

    function addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    function populateTable(textStr) {
        if (!textStr) return;
        const rows = textStr.split('\n');
        let html = '';
        for (let r of rows) {
            if (!r.trim() && r === rows[rows.length - 1]) continue;
            let cells = r.split('\t');
            while (cells.length < 5) cells.push('');
            html += '<tr>' + cells.slice(0, 5).map(c => `<td contenteditable="true">${c}</td>`).join('') + '<td class="col-delete"><button class="del-row-btn" title="Eliminar fila">✕</button></td></tr>';
        }
        inputTbody.innerHTML = html;
    }

    function ensureEmptyRows() {
        if (inputTbody.children.length === 0) {
            inputTbody.innerHTML = '';
        }
    }

    const hashData = window.location.hash.slice(1);
    let initialData = null;

    if (hashData) {
        try {
            initialData = decodeURIComponent(atob(hashData));
            if (!initialData.includes('\t')) initialData = null; // Basic format verification
        } catch (e) {
            console.error("Link inválido");
        }
    }

    if (!initialData) {
        initialData = localStorage.getItem('ganttVisionData');
    }

    if (initialData) {
        populateTable(initialData);
        // Auto-render the chart with saved toggle states
        setTimeout(() => generateBtn.click(), 0);
    }
    ensureEmptyRows();

    document.querySelector('.data-input-table').addEventListener('paste', (e) => {
        let text = (e.clipboardData || window.clipboardData).getData('text');

        // Let's only handle the paste event default-override if it looks like a multi-column or multi-row excel payload.
        // Otherwise it could be a single cell replacement.
        if (text.includes('\t') || text.includes('\n')) {
            e.preventDefault();
            populateTable(text);
        }
    });

    const addRowBtn = document.getElementById('add-row-btn');
    if (addRowBtn) {
        addRowBtn.addEventListener('click', () => {
            inputTbody.insertAdjacentHTML('beforeend', '<tr><td contenteditable="true"></td><td contenteditable="true"></td><td contenteditable="true"></td><td contenteditable="true"></td><td contenteditable="true"></td><td class="col-delete"><button class="del-row-btn" title="Eliminar fila">✕</button></td></tr>');
        });
    }

    inputTbody.addEventListener('click', (e) => {
        if (e.target.classList.contains('del-row-btn')) {
            e.target.closest('tr').remove();
            if (inputTbody.children.length === 0) ensureEmptyRows();
        }
    });

    generateBtn.addEventListener('click', () => {
        let textArr = [];
        inputTbody.querySelectorAll('tr').forEach(tr => {
            let cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText || td.textContent);
            if (cells.some(c => c.trim() !== '')) {
                textArr.push(cells.join('\t'));
            }
        });
        const text = textArr.join('\n');

        if (!text.trim()) return;

        const rows = text.split('\n');

        const deliverables = [];
        let currentParent = null;

        let minDate = null;
        let maxDate = null;

        for (let i = 0; i < rows.length; i++) {
            const rawLine = rows[i];
            if (!rawLine.trim()) continue;

            const cols = rawLine.split('\t');
            if (cols.length < 1) continue;

            const name = cols[0].trim();
            if (!name) continue;

            const startStr = cols[1];
            const endStr = cols[2];

            const start = parseDate(startStr);
            const end = parseDate(endStr);
            const planned = parsePercent(cols[3]);
            const actual = parsePercent(cols[4]);

            const nameUpper = name.toUpperCase();
            const isKnownPhase = ['FASE', 'DESARROLLO', 'PRODUCCION', 'PRODUCCI', 'CALIDAD'].some(k => nameUpper.includes(k));
            const isPhase = cols[0].startsWith(' ') || cols[0].startsWith('\xa0') || isKnownPhase;

            // Si es una fase y no tiene fechas útiles, ignorarla. Pero si es entregable, permitirlo aunque venga sin fechas para que recoja sus fases
            if (isPhase && (!start || !end)) continue;

            const safeEnd = (start && end && end < start) ? start : end;

            const itemObj = { name, start, end: safeEnd, planned, actual };

            if (start && (!minDate || start < minDate)) minDate = start;
            if (safeEnd && (!maxDate || safeEnd > maxDate)) maxDate = safeEnd;

            if (isPhase && currentParent) {
                currentParent.phases.push(itemObj);
            } else {
                currentParent = { ...itemObj, phases: [] };
                deliverables.push(currentParent);
            }
        }

        if (deliverables.length === 0) {
            alert("No se detectaron datos válidos. Usa formato: Entregable \\t 01/01/2026 \\t 31/01/2026 \\t 50 \\t 20");
            return;
        }

        // Cache data exactly
        localStorage.setItem('ganttVisionData', text);

        chartDeliverablesCache = deliverables;

        const criticalDatesSet = new Set();
        deliverables.forEach(del => {
            if (del.start && del.end) {
                criticalDatesSet.add(new Date(del.start.getFullYear(), del.start.getMonth(), del.start.getDate(), 0, 0, 0).getTime());
                criticalDatesSet.add(new Date(del.end.getFullYear(), del.end.getMonth(), del.end.getDate(), 0, 0, 0).getTime());
            }
            del.phases.forEach(ph => {
                if (ph.start && ph.end) {
                    criticalDatesSet.add(new Date(ph.start.getFullYear(), ph.start.getMonth(), ph.start.getDate(), 0, 0, 0).getTime());
                    criticalDatesSet.add(new Date(ph.end.getFullYear(), ph.end.getMonth(), ph.end.getDate(), 0, 0, 0).getTime());
                }
            });
        });

        // Asegurar que siempre intentamos poner el min y max como críticos
        if (minDate) criticalDatesSet.add(minDate.getTime());
        if (maxDate) criticalDatesSet.add(maxDate.getTime());

        const criticalDates = Array.from(criticalDatesSet).sort((a, b) => a - b);

        // Gap Compression Calculator
        let intervals = [];
        deliverables.forEach(d => {
            if (d.start && d.end) intervals.push({ s: d.start.getTime(), e: d.end.getTime() });
            d.phases.forEach(p => {
                if (p.start && p.end) intervals.push({ s: p.start.getTime(), e: p.end.getTime() });
            });
        });
        intervals.sort((a, b) => a.s - b.s);

        let activeRanges = [];
        if (intervals.length > 0) {
            let current = { s: intervals[0].s, e: intervals[0].e };
            for (let i = 1; i < intervals.length; i++) {
                if (intervals[i].s <= current.e + (7 * DAY_MS)) {
                    current.e = Math.max(current.e, intervals[i].e);
                } else {
                    activeRanges.push(current);
                    current = { s: intervals[i].s, e: intervals[i].e };
                }
            }
            activeRanges.push(current);
        }

        let gaps = [];
        for (let i = 0; i < activeRanges.length - 1; i++) {
            const gapStart = activeRanges[i].e;
            const gapEnd = activeRanges[i + 1].s;
            const gapDays = Math.round((gapEnd - gapStart) / DAY_MS);
            if (gapDays > 14) {
                gaps.push({ s: gapStart, e: gapEnd, realDays: gapDays, visualDays: 4 });
            }
        }

        const mapVirtualDays = (ts) => {
            let realDaysTotal = (ts - minDate.getTime()) / DAY_MS;
            let totalShift = 0;
            for (const g of gaps) {
                if (ts >= g.e) {
                    // Si la fecha es posterior al gap, restamos todo el exceso del gap
                    totalShift += (g.realDays - g.visualDays);
                } else if (ts > g.s && ts < g.e) {
                    // Si la fecha cae DENTRO del gap, aplicamos una compresión lineal para evitar amontonamientos
                    const daysIntoGap = (ts - g.s) / DAY_MS;
                    const compressionFactor = 1 - (g.visualDays / g.realDays);
                    totalShift += daysIntoGap * compressionFactor;
                    break; // No procesamos más gaps ya que ts está dentro de este
                }
            }
            return Math.max(0, realDaysTotal - totalShift);
        };

        const totalVirtualDays = mapVirtualDays(maxDate.getTime());

        renderGantt(deliverables, minDate, maxDate, criticalDates, null, totalVirtualDays, mapVirtualDays);
    });

    function renderGantt(deliverables, minDate, maxDate, criticalDates, fillerDates, totalVisualDays, mapVirtualDays) {

        emptyState.style.display = 'none';

        const mainLegend = document.getElementById('main-legend');
        if (mainLegend) mainLegend.style.display = (document.getElementById('toggle-legend')?.checked ?? true) ? 'flex' : 'none';

        tableWrapper.style.display = 'block';

        // Read toggle states
        const showPercent   = document.getElementById('toggle-percent')?.checked   ?? true;
        const showMonths    = document.getElementById('toggle-months')?.checked    ?? false;
        const showQuarters  = document.getElementById('toggle-quarters')?.checked  ?? false;
        const showSemesters = document.getElementById('toggle-semesters')?.checked ?? false;
        const showYears     = document.getElementById('toggle-years')?.checked     ?? false;
        const showDates     = document.getElementById('toggle-dates')?.checked     ?? true;
        const isCylindrical = document.getElementById('toggle-cylindrical')?.checked ?? false;

        // Apply cylindrical class to table
        const ganttTable = document.getElementById('gantt-table');
        if (ganttTable) {
            if (isCylindrical) ganttTable.classList.add('cylindrical-bars');
            else ganttTable.classList.remove('cylindrical-bars');
        }

        // Show/hide period header rows
        const monthsHeaderRow    = document.getElementById('months-header-row');
        const quartersHeaderRow  = document.getElementById('quarters-header-row');
        const semestersHeaderRow = document.getElementById('semesters-header-row');
        const yearsHeaderRow     = document.getElementById('years-header-row');
        const datesHeaderRow     = timelineHeader.parentElement; // The row containing timelineHeader

        if (monthsHeaderRow)    monthsHeaderRow.style.display    = showMonths    ? '' : 'none';
        if (quartersHeaderRow)  quartersHeaderRow.style.display  = showQuarters  ? '' : 'none';
        if (semestersHeaderRow) semestersHeaderRow.style.display = showSemesters ? '' : 'none';
        if (yearsHeaderRow)     yearsHeaderRow.style.display     = showYears     ? '' : 'none';

        // Determinar si hay algún encabezado superior activo
        const anyPeriodActive = showMonths || showQuarters || showSemesters || showYears;
        if (anyPeriodActive) {
            timelineHeader.classList.add('headers-active');
        } else {
            timelineHeader.classList.remove('headers-active');
        }

        // No ocultamos el datesHeaderRow por completo para mantener las líneas verticales (date-line)
        if (datesHeaderRow) {
            if (showDates) {
                datesHeaderRow.style.display = '';
                datesHeaderRow.classList.remove('dates-hidden');
            } else {
                datesHeaderRow.style.display = '';
                datesHeaderRow.classList.add('dates-hidden');
            }
        }

        // Dynamic exact width compression locking the chart inside horizontal view
        const targetWrapper = document.getElementById('table-wrapper');
        const PADDING_X = 40; // Protect boundaries natively
        const availablePixels = targetWrapper.clientWidth - 100 - (PADDING_X * 2);
        const dynamicDayWidth = Math.max(0.01, availablePixels / Math.max(1, totalVisualDays));
        document.documentElement.style.setProperty('--day-width', `${dynamicDayWidth}px`);

        timelineHeader.style.minWidth = `calc(${PADDING_X * 2}px + var(--day-width) * ${totalVisualDays})`;

        let htmlTimelineHeader = '';
        let acceptedPx = [];
        let acceptedPlacements = [];

        const attemptPlacement = (ts, isCritical = false) => {
            const virtualLeft = mapVirtualDays(ts);
            const absoluteLeftPx = virtualLeft * dynamicDayWidth;

            let conflict = false;
            // Umbral de 70px para permitir más fechas pero sin solapamiento real
            const threshold = 70; 
            for (let px of acceptedPx) {
                if (Math.abs(absoluteLeftPx - px) < threshold) {
                    conflict = true; break;
                }
            }
            if (!conflict) {
                acceptedPx.push(absoluteLeftPx);
                acceptedPlacements.push({ ts, virtualLeft });
                return true;
            }
            return false;
        };

        // 1. Priorizar fechas críticas (inicio/fin)
        criticalDates.forEach(ts => attemptPlacement(ts, true));
        
        // Ordenar las aceptadas para evaluar huecos visuales
        acceptedPlacements.sort((a, b) => a.ts - b.ts);

        // 2. Relleno dinámico e inteligente: se adapta a la escala (años, meses, días)
        const totalDays = Math.round((maxDate - minDate) / DAY_MS);
        let step = 1; // Por defecto 1 día
        
        if (totalDays > 365 * 2) step = 30 * 3; // Si dura más de 2 años, saltos de 3 meses
        else if (totalDays > 365) step = 30;    // Si dura más de 1 año, saltos de 1 mes
        else if (totalDays > 60) step = 15;     // Si dura más de 2 meses, saltos de 15 días
        else if (totalDays > 30) step = 7;      // Si dura más de 1 mes, saltos de 7 días
        else step = 2;                         // Proyectos cortos, saltos de 2 días

        // Generar posibles fechas de relleno
        let curr = new Date(minDate);
        while (curr <= maxDate) {
            attemptPlacement(curr.getTime(), false);
            curr = addDays(curr, step);
        }

        // 3. Relleno de emergencia para huecos visuales residuales (> 120px)
        acceptedPlacements.sort((a, b) => a.ts - b.ts);
        let i = 0;
        while (i < acceptedPlacements.length - 1) {
            const current = acceptedPlacements[i];
            const next = acceptedPlacements[i+1];
            const currentPx = current.virtualLeft * dynamicDayWidth;
            const nextPx = next.virtualLeft * dynamicDayWidth;
            
            if (nextPx - currentPx > 120) {
                const midTs = (current.ts + next.ts) / 2;
                if (attemptPlacement(midTs, false)) {
                    acceptedPlacements.sort((a, b) => a.ts - b.ts);
                    continue; 
                }
            }
            i++;
        }

        acceptedPlacements.sort((a, b) => a.ts - b.ts);

        acceptedPlacements.forEach(item => {
            const d = new Date(item.ts);
            const dateStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            htmlTimelineHeader += `
               <div class="date-marker" style="left: calc(${PADDING_X}px + var(--day-width) * ${item.virtualLeft});">${dateStr}</div>
               <div class="date-line" style="left: calc(${PADDING_X}px + var(--day-width) * ${item.virtualLeft});"></div>
            `;
        });

        timelineHeader.innerHTML = htmlTimelineHeader;

        // ── Helper: build period bands ────────────────────────────────────────
        const ROMAN = ['I','II','III','IV','V','VI'];

        function buildPeriodBands(headerEl, periods, type = '') {
            if (!headerEl) return;
            // Quitamos el minWidth fijo para evitar que el fondo se extienda más allá de las bandas reales
            headerEl.style.minWidth = '0'; 
            let html = '';
            for (const p of periods) {
                const bandStart = p.start < minDate ? minDate : p.start;
                const bandEnd   = p.end   > maxDate ? maxDate : p.end;
                if (bandStart > maxDate || bandEnd < minDate) continue;
                const leftVd  = mapVirtualDays(bandStart.getTime());
                const rightVd = mapVirtualDays(bandEnd.getTime());
                const widthPx = (rightVd - leftVd) * dynamicDayWidth;

                let finalLabel = p.label;
                let rotatedClass = '';

                if (type === 'month') {
                    // Si el mes no cabe (aprox 60px para "Ene-2026"), rotar
                    if (widthPx < 60) {
                        rotatedClass = 'rotated';
                        finalLabel = `<span>${p.label}</span>`;
                    }
                } else if (type === 'quarter') {
                    // Si el trimestre no cabe completo, abreviar
                    if (widthPx < 120) {
                        finalLabel = p.shortLabel || p.label;
                    }
                } else if (type === 'semester') {
                    // Si el semestre no cabe completo, abreviar
                    if (widthPx < 120) {
                        finalLabel = p.shortLabel || p.label;
                    }
                }

                html += `<div class="month-band ${rotatedClass}" style="left:calc(${PADDING_X}px + var(--day-width) * ${leftVd}); width:calc(var(--day-width) * ${Math.max(0.01, rightVd - leftVd)});">${finalLabel}</div>`;
            }
            headerEl.innerHTML = html;
        }

        // Build year bands
        const yearsHeader = document.getElementById('years-header');
        if (yearsHeader) {
            if (showYears) {
                const periods = [];
                let cur = new Date(minDate.getFullYear(), 0, 1);
                while (cur <= maxDate) {
                    periods.push({
                        start: new Date(cur.getFullYear(), 0, 1),
                        end:   new Date(cur.getFullYear(), 11, 31),
                        label: `${cur.getFullYear()}`
                    });
                    cur = new Date(cur.getFullYear() + 1, 0, 1);
                }
                buildPeriodBands(yearsHeader, periods, 'year');
            } else {
                yearsHeader.innerHTML = '';
                yearsHeader.style.minWidth = '';
            }
        }

        // Build month bands
        const monthsHeader = document.getElementById('months-header');
        if (monthsHeader) {
            if (showMonths) {
                const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
                const periods = [];
                let cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
                while (cur <= maxDate) {
                    periods.push({
                        start: new Date(cur.getFullYear(), cur.getMonth(), 1),
                        end:   new Date(cur.getFullYear(), cur.getMonth() + 1, 0),
                        label: `${MONTHS_ES[cur.getMonth()]}-${cur.getFullYear()}`
                    });
                    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
                }
                buildPeriodBands(monthsHeader, periods, 'month');
            } else {
                monthsHeader.innerHTML = '';
                monthsHeader.style.minWidth = '';
            }
        }

        // Build quarter bands
        const quartersHeader = document.getElementById('quarters-header');
        if (quartersHeader) {
            if (showQuarters) {
                const periods = [];
                let startYear = minDate.getFullYear();
                let startQ    = Math.floor(minDate.getMonth() / 3);
                let cur = new Date(startYear, startQ * 3, 1);
                while (cur <= maxDate) {
                    const qIdx  = Math.floor(cur.getMonth() / 3);
                    const qEnd  = new Date(cur.getFullYear(), qIdx * 3 + 3, 0);
                    periods.push({
                        start: new Date(cur.getFullYear(), qIdx * 3, 1),
                        end:   qEnd,
                        label: `${ROMAN[qIdx]} Trimestre ${cur.getFullYear()}`,
                        shortLabel: `${ROMAN[qIdx]} Trim.`
                    });
                    cur = new Date(cur.getFullYear(), qIdx * 3 + 3, 1);
                }
                buildPeriodBands(quartersHeader, periods, 'quarter');
            } else {
                quartersHeader.innerHTML = '';
                quartersHeader.style.minWidth = '';
            }
        }

        // Build semester bands
        const semestersHeader = document.getElementById('semesters-header');
        if (semestersHeader) {
            if (showSemesters) {
                const periods = [];
                let startYear = minDate.getFullYear();
                let startS    = minDate.getMonth() < 6 ? 0 : 1;
                let cur = new Date(startYear, startS * 6, 1);
                while (cur <= maxDate) {
                    const sIdx = cur.getMonth() < 6 ? 0 : 1;
                    const sEnd = new Date(cur.getFullYear(), sIdx * 6 + 6, 0);
                    periods.push({
                        start: new Date(cur.getFullYear(), sIdx * 6, 1),
                        end:   sEnd,
                        label: `${ROMAN[sIdx]} Semestre ${cur.getFullYear()}`,
                        shortLabel: `${ROMAN[sIdx]} Sem.`
                    });
                    cur = new Date(cur.getFullYear(), sIdx * 6 + 6, 1);
                }
                buildPeriodBands(semestersHeader, periods, 'semester');
            } else {
                semestersHeader.innerHTML = '';
                semestersHeader.style.minWidth = '';
            }
        }

        function drawChartCell(item, type, contextLabel, isPhase, topOffset = null) {
            if (!item.start || !item.end) return '';

            const leftDays = mapVirtualDays(item.start.getTime());
            const endDays = mapVirtualDays(item.end.getTime());
            const durationWidthFixed = Math.max(0.01, endDays - leftDays);

            let styleClass = (type === 'planned' || type === 'phase-box') ? 'planned-style' : 'actual-style';

            let customPhaseBg = '';
            let phaseTitleTag = '';

            let valueDisplay = type === 'planned' ? item.planned : (type === 'actual' ? item.actual : 100);

            // Si el valor es null (campo vacío), no renderizar esta barra
            if (valueDisplay === null && (type === 'planned' || type === 'actual')) return '';

            // Unique bar ID for color persistence
            const barId = `bar__${item.name}__${type}`.replace(/\s+/g, '_');
            const savedColor = barColors[barId];
            const colorOverride = savedColor ? `background:${savedColor} !important;` : '';

            const pctLabel = showPercent ? `<span class="percent-label" style="position:absolute; left: 6px;">${valueDisplay}%</span>` : '';
            let barFillHtml = `<div class="bar-fill" style="width: ${valueDisplay}%; ${savedColor ? `background:${savedColor};` : ''}">
                       ${pctLabel}
                   </div>`;

            // Adjustments for non-phases (they keep centering)
            let topStyle = topOffset !== null ? `top: ${topOffset}px; transform: none; margin: 0;` : '';

            if (isPhase && type === 'phase-box') {
                styleClass = ''; 
                let bg = 'var(--phase-planned-bg)';
                const lower = item.name.toLowerCase();
                if (lower.includes('desarrollo')) bg = 'var(--phase-dev-bg)';
                else if (lower.includes('calidad')) bg = 'var(--phase-qa-bg)';
                else if (lower.includes('producc')) bg = 'var(--phase-prod-bg)';
                
                customPhaseBg = `background: ${bg}; border: 1px dashed var(--phase-planned-border); border-radius: 4px 4px 0 0; box-sizing: border-box; display: flex; align-items:center; justify-content:center; height: 22px; position:relative; overflow:hidden;`;
                phaseTitleTag = `<span style="font-size: 0.70rem; color: var(--text-main); font-weight: 700; z-index:5; padding: 0 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; text-align:center; position:absolute; left:0; pointer-events:none;">${item.name}</span>`;
                barFillHtml = ''; 
            } else if (isPhase && type === 'planned') {
                styleClass = '';
                customPhaseBg = `height: 16px; border: 1px dashed var(--phase-planned-border); border-top: none; box-sizing: border-box; background: var(--border-color); border-radius: 0; position: relative;`;
                
                barFillHtml = `<div class="bar-fill" style="width: ${valueDisplay}%; height: 100%; background: ${savedColor || 'var(--planned-color)'}; border-radius: 0;">
                       ${showPercent ? `<span class="percent-label" style="position:absolute; left: 6px; top: 50%; transform: translateY(-50%); font-size: 0.65rem;">${valueDisplay}% Plan</span>` : ''}
                   </div>`;
            } else if (isPhase && type === 'actual') {
                styleClass = ''; 
                customPhaseBg = `background: var(--border-color); border: 1px dashed var(--phase-planned-border); border-top: none; box-sizing: border-box; height: 16px; position: relative; border-radius: 0 0 4px 4px; overflow: hidden;`;
                barFillHtml = `<div class="bar-fill" style="width: ${valueDisplay}%; height: 100%; background: ${savedColor || 'var(--phase-actual-fill)'}; border-radius: 0;">
                    ${showPercent ? `<span class="percent-label" style="position:absolute; left: 6px; top: 50%; transform: translateY(-50%); color: #ef4444; font-size: 0.65rem;">${valueDisplay}% Real</span>` : ''}
                </div>`;
            } else if (!isPhase && type === 'planned') {
                phaseTitleTag = ``; 
            }

            return `
            <div class="chart-cell" title="${item.name} - ${contextLabel}">
               <div class="bar-bg-container bar-clickable ${styleClass}" data-bar-id="${barId}" style="left: calc(${PADDING_X}px + var(--day-width) * ${leftDays}); width: calc(var(--day-width) * ${durationWidthFixed}); ${topStyle} ${customPhaseBg}">
                   ${phaseTitleTag}
                   ${barFillHtml}
               </div>
            </div>
            `;
        }

        let htmlRows = '';

        function drawPhaseBlock(phase) {
            if (!phase.start || !phase.end) return '';

            // Si no hay % planificado ni % real, mostrar barra llena al 100%
            if (phase.planned === null && phase.actual === null) {
                phase.planned = 100;
            }
            const leftDays = mapVirtualDays(phase.start.getTime());
            const endDays = mapVirtualDays(phase.end.getTime());
            const durationWidthFixed = Math.max(0.01, endDays - leftDays);

            let bg = 'var(--phase-planned-bg)';
            const lower = phase.name.toLowerCase();
            if (lower.includes('desarrollo')) bg = 'var(--phase-dev-bg)';
            else if (lower.includes('calidad')) bg = 'var(--phase-qa-bg)';
            else if (lower.includes('producc')) bg = 'var(--phase-prod-bg)';

            const barIdPlan   = `bar__${phase.name}__planned`.replace(/\s+/g, '_');
            const barIdActual = `bar__${phase.name}__actual`.replace(/\s+/g, '_');
            const barIdBox    = `bar__${phase.name}__phase-box`.replace(/\s+/g, '_');
            const colorPlan   = barColors[barIdPlan]   || 'var(--planned-color)';
            const colorActual = barColors[barIdActual] || 'var(--phase-actual-fill)';
            const colorBox    = barColors[barIdBox]    || bg;

            return `
            <div class="bar-bg-container bar-clickable" data-bar-id="${barIdBox}" title="${phase.name}" style="position: absolute; left: calc(${PADDING_X}px + var(--day-width) * ${leftDays}); width: calc(var(--day-width) * ${durationWidthFixed}); top: 50%; transform: translateY(-50%); border: 1px dashed var(--phase-planned-border); border-radius: 4px; display: flex; flex-direction: column; overflow: hidden; background: ${colorBox}; height: auto;">
                <div style="height: 22px; display: flex; align-items: center; justify-content: center; font-size: 0.70rem; color: var(--text-main); font-weight: 700; border-bottom: 1px dashed var(--phase-planned-border); position: relative; z-index: 5;">
                    ${phase.name}
                </div>
                ${phase.planned !== null ? `<div class="bar-bg-container bar-clickable" data-bar-id="${barIdPlan}" style="position:relative; height: 18px; background: var(--border-color); border-bottom: 1px dashed var(--phase-planned-border);">
                    <div style="position: absolute; left: 0; top: 0; height: 100%; width: ${phase.planned}%; background: ${colorPlan}; opacity: 0.9;"></div>
                    ${showPercent ? `<span style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); font-size: 0.65rem; color: var(--text-main); font-weight: 700; z-index: 2;">${phase.planned}% Plan</span>` : ''}
                </div>` : ''}
                ${phase.actual !== null ? `<div class="bar-bg-container bar-clickable" data-bar-id="${barIdActual}" style="position:relative; height: 18px; background: var(--border-color);">
                    <div style="position: absolute; left: 0; top: 0; height: 100%; width: ${phase.actual}%; background: ${colorActual}; opacity: 0.9;"></div>
                    ${showPercent ? `<span style="position: absolute; left: 6px; top: 50%; transform: translateY(-50%); font-size: 0.65rem; color: #ef4444; font-weight: 700; z-index: 2;">${phase.actual}% Real</span>` : ''}
                </div>` : ''}
            </div>
            `;
        }

        deliverables.forEach(deliverable => {
            const hasPhases = deliverable.phases.length > 0;
            const hasParentBars = deliverable.start !== null && deliverable.end !== null;

            // Si no hay % planificado ni % real, mostrar barra llena al 100% (planificado)
            if (hasParentBars && deliverable.planned === null && deliverable.actual === null) {
                deliverable.planned = 100;
            }

            let rowsForDiv = 0;
            if (hasParentBars) {
                if (deliverable.planned !== null) rowsForDiv += 1;
                if (deliverable.actual !== null) rowsForDiv += 1;
            }
            if (hasPhases) rowsForDiv += deliverable.phases.length;

            if (rowsForDiv === 0) {
                // Si no hay nada que mostrar (ni barras de padre ni fases), no renderizar la fila
                return;
            }

            const delivBottomStyle = (hasPhases || !hasParentBars) ? '' : 'border-bottom: 2px solid #94a3b8;';
            let firstRowRendered = false;

            if (hasParentBars) {
                const hasPlan = deliverable.planned !== null;
                const hasActual = deliverable.actual !== null;

                if (hasPlan && hasActual) {
                    htmlRows += `
                    <tr>
                        <td rowspan="${rowsForDiv}" class="col-main">${deliverable.name}</td>
                        <td class="col-timeline">${drawChartCell(deliverable, 'planned', 'Plan.', false)}</td>
                    </tr>
                    <tr>
                        <td class="col-timeline" style="${delivBottomStyle}">${drawChartCell(deliverable, 'actual', 'Real', false)}</td>
                    </tr>
                    `;
                } else if (hasPlan) {
                    htmlRows += `
                    <tr>
                        <td rowspan="${rowsForDiv}" class="col-main">${deliverable.name}</td>
                        <td class="col-timeline" style="${delivBottomStyle}">${drawChartCell(deliverable, 'planned', 'Plan.', false)}</td>
                    </tr>
                    `;
                } else if (hasActual) {
                    htmlRows += `
                    <tr>
                        <td rowspan="${rowsForDiv}" class="col-main">${deliverable.name}</td>
                        <td class="col-timeline" style="${delivBottomStyle}">${drawChartCell(deliverable, 'actual', 'Real', false)}</td>
                    </tr>
                    `;
                }
                firstRowRendered = true;
            }

            deliverable.phases.forEach((phase, idx) => {
                const isLastPhase = idx === deliverable.phases.length - 1;
                const phaseBottomStyle = isLastPhase ? 'border-bottom: 2px solid #94a3b8;' : 'border-bottom: 1px solid var(--border-color);';

                if (!firstRowRendered) {
                    htmlRows += `
                    <tr>
                        <td rowspan="${rowsForDiv}" class="col-main" style="${phaseBottomStyle}">${deliverable.name}</td>
                        <td class="col-timeline" style="${phaseBottomStyle} height: 70px; padding: 0;">
                            <div style="position: relative; width: 100%; height: 100%;">
                                ${drawPhaseBlock(phase)}
                            </div>
                        </td>
                    </tr>
                    `;
                    firstRowRendered = true;
                } else {
                    htmlRows += `
                    <tr>
                        <td class="col-timeline" style="${phaseBottomStyle} height: 70px; padding: 0;">
                            <div style="position: relative; width: 100%; height: 100%;">
                                ${drawPhaseBlock(phase)}
                            </div>
                        </td>
                    </tr>
                    `;
                }
            });
        });

        ganttTbody.innerHTML = htmlRows;

        if (fullScreenBtn) fullScreenBtn.style.display = 'block';

        const shareLinkBtn = document.getElementById('share-link-btn');
        const exportImgBtn = document.getElementById('export-img-btn');
        if (shareLinkBtn) shareLinkBtn.style.display = 'block';
        if (exportImgBtn) exportImgBtn.style.display = 'block';
    }

    if (fullScreenBtn) {
        fullScreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                ganttWrapper.requestFullscreen().catch(err => console.error(err));
            } else {
                document.exitFullscreen();
            }
        });
    }

    const showToast = (msg) => {
        const t = document.createElement('div');
        t.innerText = msg;
        t.className = 'toast-notification';
        document.body.appendChild(t);
        setTimeout(() => t.classList.add('show'), 10);
        setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => t.remove(), 300);
        }, 2000);
    };

    const shareLinkBtn = document.getElementById('share-link-btn');
    if (shareLinkBtn) {
        shareLinkBtn.addEventListener('click', () => {
            let textArr = [];
            inputTbody.querySelectorAll('tr').forEach(tr => {
                let cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText || td.textContent);
                if (cells.some(c => c.trim() !== '')) {
                    textArr.push(cells.slice(0, 5).join('\t'));
                }
            });
            const text = textArr.join('\n');
            if (!text.trim()) return showToast("No hay datos cargados para compartir.");

            const encoded = btoa(encodeURIComponent(text));
            const newUrl = window.location.origin + window.location.pathname + "#" + encoded;

            navigator.clipboard.writeText(newUrl).then(() => {
                showToast("Enlace copiado");
            }).catch(err => {
                prompt("Por favor copia manualmente este enlace:", newUrl);
            });
        });
    }

    // ── Color Picker ──────────────────────────────────────────────────────────
    const COLOR_PALETTE = [
        '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e','#10b981',
        '#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7','#ec4899',
        '#f43f5e','#64748b','#94a3b8','#cbd5e1','#1e293b','#0f172a','#ffffff',
    ];

    const popover   = document.getElementById('color-picker-popover');
    const swatchBox = document.getElementById('color-swatches');
    const customColorInput = document.getElementById('custom-color-input');
    const resetBtn  = document.getElementById('color-reset-btn');

    // Build swatches once
    COLOR_PALETTE.forEach(hex => {
        const sw = document.createElement('div');
        sw.className = 'color-swatch';
        sw.style.background = hex;
        sw.style.border = hex === '#ffffff' ? '2px solid #cbd5e1' : '2px solid transparent';
        sw.title = hex;
        sw.addEventListener('click', () => applyBarColor(hex));
        swatchBox.appendChild(sw);
    });

    let activeBarEl  = null;
    let activeBarId  = null;

    function openColorPopover(barEl, barId, event) {
        event.stopPropagation();
        // Deselect previous
        document.querySelectorAll('.bar-selected').forEach(el => el.classList.remove('bar-selected'));

        activeBarEl = barEl;
        activeBarId = barId;
        barEl.classList.add('bar-selected');

        // Set custom input to current color
        const current = barColors[barId];
        customColorInput.value = current && current.startsWith('#') ? current : '#3b82f6';

        // Position popover near the click
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        popover.style.display = 'block';
        const pw = popover.offsetWidth  || 210;
        const ph = popover.offsetHeight || 180;
        let x = event.clientX + 8;
        let y = event.clientY + 8;
        if (x + pw > vw - 8) x = event.clientX - pw - 8;
        if (y + ph > vh - 8) y = event.clientY - ph - 8;
        popover.style.left = `${x}px`;
        popover.style.top  = `${y}px`;
    }

    function applyBarColor(color) {
        if (!activeBarEl || !activeBarId) return;
        barColors[activeBarId] = color;
        localStorage.setItem('ganttBarColors', JSON.stringify(barColors));

        // Apply directly to the element — find the .bar-fill child if present
        const fill = activeBarEl.querySelector('.bar-fill');
        if (fill) {
            fill.style.background = color;
        } else {
            // Phase box background
            activeBarEl.style.background = color;
        }
        // Also update the inner colored div for phase sub-bars
        const innerFill = activeBarEl.querySelector('div[style*="position: absolute"]');
        if (innerFill) innerFill.style.background = color;
    }

    customColorInput.addEventListener('input', (e) => {
        applyBarColor(e.target.value);
    });

    resetBtn.addEventListener('click', () => {
        if (!activeBarId) return;
        delete barColors[activeBarId];
        localStorage.setItem('ganttBarColors', JSON.stringify(barColors));
        closePopover();
        generateBtn.click(); // Re-render to restore default color
    });

    function closePopover() {
        popover.style.display = 'none';
        document.querySelectorAll('.bar-selected').forEach(el => el.classList.remove('bar-selected'));
        activeBarEl = null;
        activeBarId = null;
    }

    // Delegate click on gantt tbody for bar-clickable elements
    document.getElementById('gantt-tbody').addEventListener('click', (e) => {
        const bar = e.target.closest('.bar-clickable');
        if (bar && bar.dataset.barId) {
            openColorPopover(bar, bar.dataset.barId, e);
        }
    });

    // Close popover on outside click
    document.addEventListener('click', (e) => {
        if (popover.style.display !== 'none' && !popover.contains(e.target) && !e.target.closest('.bar-clickable')) {
            closePopover();
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePopover();
    });
    // ── End Color Picker ──────────────────────────────────────────────────────

    const exportImgBtn = document.getElementById('export-img-btn');
    if (exportImgBtn) {
        exportImgBtn.addEventListener('click', () => {
            const container = document.getElementById('gantt-container-to-export');
            const ganttTable = document.getElementById('gantt-table');
            if (!container || !ganttTable) return;

            // Calcular altura real: logo-header + tabla
            const headerHeight = document.querySelector('.gantt-header-top')?.offsetHeight || 0;
            const tableHeight = ganttTable.offsetHeight;
            const totalCaptureHeight = headerHeight + tableHeight + 10; // +10 de margen

            // Asegurar que el scroll horizontal esté al inicio
            const tableWrapper = document.getElementById('table-wrapper');
            const originalScrollLeft = tableWrapper.scrollLeft;
            tableWrapper.scrollLeft = 0;

            html2canvas(container, {
                backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-color'),
                scale: 3, 
                useCORS: true,
                logging: false,
                scrollX: 0,
                scrollY: 0,
                width: container.scrollWidth,
                height: totalCaptureHeight, // Usar la altura real calculada
                onclone: (clonedDoc) => {
                    const clonedBody = clonedDoc.body;
                    clonedBody.setAttribute('data-theme', document.body.getAttribute('data-theme'));
                    
                    const clonedContainer = clonedDoc.getElementById('gantt-container-to-export');
                    if (clonedContainer) {
                        clonedContainer.style.width = container.scrollWidth + 'px';
                        clonedContainer.style.height = totalCaptureHeight + 'px';
                        clonedContainer.style.overflow = 'hidden'; // Evitar scrollbars en captura
                        clonedContainer.style.background = getComputedStyle(document.body).getPropertyValue('--bg-color');
                    }

                    // Limitar la altura de las líneas guía en el clon para que no estiren el scrollHeight
                    clonedDoc.querySelectorAll('.date-line').forEach(line => {
                        line.style.height = tableHeight + 'px';
                    });

                    // Forzar visualización del logo en el clon
                    const clonedLogo = clonedDoc.getElementById('bn-logo');
                    if (clonedLogo) {
                        clonedLogo.style.display = 'block';
                    }

                    // Corregir rotación para html2canvas
                    clonedDoc.querySelectorAll('.month-band.rotated').forEach(el => {
                        el.style.writingMode = 'vertical-rl';
                        el.style.transform = 'none'; 
                        el.style.display = 'flex';
                        el.style.alignItems = 'center';
                        el.style.justifyContent = 'center';
                        el.style.height = '80px';
                    });
                }
            }).then(canvas => {
                tableWrapper.scrollLeft = originalScrollLeft;
                canvas.toBlob(blob => {
                    saveAs(blob, `cronograma_${new Date().getTime()}.png`);
                });
                showToast("Imagen generada correctamente");
            }).catch(err => {
                tableWrapper.scrollLeft = originalScrollLeft;
                console.error("Error al exportar imagen:", err);
                showToast("Error al generar la imagen");
            });
        });
    }

}); // end DOMContentLoaded

