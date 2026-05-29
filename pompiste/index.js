// ── AUTH GUARD ────────────────────────────────────────────────
// Redirects to sign-in if not logged in or not a pompiste.
(async function () {
  const profile = await requireAuth({ roles: ["pompiste"] });
  if (!profile) return;
  const el = document.getElementById("welcomeMessage");
  if (el) el.textContent = `Welcome, ${profile.name || ""}`;
})();

// ── INDEX STATE (set by calculateIndex) ───────────────────────
let totalVente, pms1, pms2, pms3, pms4, ago1, ago2, ago3, ago4;
let venteLitresPms, totalPms, venteLitresAgo, totalAgo;
let pmsPrice, agoPrice, logDate, shift;

// ── SETTINGS STATE (set by initSettings on load) ──────────────
let momoFeePercent = 0;

// ── LOAD SETTINGS ON PAGE OPEN ────────────────────────────────
// Reads pmsPrice, agoPrice, momoFeePercent from the single fixed
// settings document so MomoLoss() always uses the correct rate,
// even before the pompiste clicks "Calculate Index".


async function initSettings() {
    try {

        const { fuelPriceHistory } = await apiFetch(`/fuel-prices/me`).then(r => r.json());
        const { stations } = await apiFetch(`/stations`).then(r => r.json());

        const station = stations[0];
        const documents = fuelPriceHistory.documents;
        
        const pms = documents.find(d => d.fuelType === "PMS");
        const ago = documents.find(d => d.fuelType === "AGO");

        pmsPrice       = pms.price       ?? 2303;
        agoPrice       = ago.price       ?? 2205;
        momoFeePercent = station.momoFee ?? 0.5;
        
        document.getElementById("pmsPrice").textContent = `${pmsPrice.toLocaleString()} RWF`;
        document.getElementById("agoPrice").textContent = `${agoPrice.toLocaleString()} RWF`;
    } catch {
        // No settings saved yet — use safe defaults
        pmsPrice       = 2303;
        agoPrice       = 2205;
        momoFeePercent = 0.5;
    }
}
initSettings();

async function calculateIndex() {

    pms1 =Number(document.getElementById("pms1").value);
    pms2 =Number(document.getElementById("pms2").value);
    pms3 =Number(document.getElementById("pms3").value);
    pms4 =Number(document.getElementById("pms4").value);
    ago1 =Number(document.getElementById("ago1").value);
    ago2 =Number(document.getElementById("ago2").value);
    ago3 =Number(document.getElementById("ago3").value);
    ago4 =Number(document.getElementById("ago4").value);
    logDate= document.getElementById("logDate").value;
    shift = document.getElementById("shift").value;

    if (pms1 && pms2 && pms2 < pms1) { toast("P1: End value must be ≥ Start value", "warning"); return; }
    if (pms3 && pms4 && pms4 < pms3) { toast("P2: End value must be ≥ Start value", "warning"); return; }
    if (ago1 && ago2 && ago2 < ago1) { toast("P3: End value must be ≥ Start value", "warning"); return; }
    if (ago3 && ago4 && ago4 < ago3) { toast("P4: End value must be ≥ Start value", "warning"); return; }

    venteLitresPms = (pms2 - pms1) + (pms4 - pms3);
    totalPms = parseInt(venteLitresPms*pmsPrice, 10);

    venteLitresAgo = (ago2 - ago1) + (ago4 - ago3);
    totalAgo = parseInt(venteLitresAgo*agoPrice, 10);

    totalVente = totalAgo + totalPms;

    document.getElementById("resultpms").textContent = `${totalPms.toLocaleString()} RWF`;
    document.getElementById("resultago").textContent = `${totalAgo.toLocaleString()} RWF`;
    document.getElementById("result").textContent = `${totalVente.toLocaleString()} RWF`;

    try {

        async function getDayBefore(logDate) {

            if (!logDate) { toast("Select a date!", "warning"); return; }

            const selectedDate = new Date(logDate);
            selectedDate.setDate(selectedDate.getDate() - 1);

            const mm = String(selectedDate.getMonth() + 1).padStart(2, '0'); // Months are 0-based
            const dd = String(selectedDate.getDate()).padStart(2, '0');
            const yyyy = selectedDate.getFullYear();

            return `${yyyy}-${mm}-${dd}`;

        }

        const dateBefore = await getDayBefore(logDate);
        let pmsMatch = false;
        let agoMatch = false;

        const { dailyReport } = await apiFetch(`/daily-reports/me?logDate=${logDate}`).then(r => r.json());
        const document = dailyReport.documents;

        for (const doc of document) {
            // Check PMS match if values are provided
            if (pms1 && pms3) {
                if (pms1 === doc.pms2 && pms3 === doc.pms4) {
                    pmsMatch = true;
                }
            } else {
                // If PMS not provided, consider it as found
                pmsMatch = true;
            }

            // Check AGO match if values are provided
            if (ago1 && ago3) {
                if (ago1 === doc.ago2 && ago3 === doc.ago4) {
                    agoMatch = true;
                }
            } else {
                // If AGO not provided, consider it as found
                agoMatch = true;
            }

            // If both are found, we can break early
            if (pmsMatch && agoMatch) {
                break;
            }
        }

        let match = pmsMatch && agoMatch;

        if (!match) {
            pmsMatch = false;
            agoMatch = false;

            const beforeResponse = await apiFetch(`/daily-reports/me?logDate=${dateBefore}`).then(r => r.json());
            const beforeDocuments = beforeResponse.dailyReport.documents;

            for (const doc of beforeDocuments) {
                // Check PMS match if values are provided
                if (pms1 && pms3) {
                    if (pms1 === doc.pms2 && pms3 === doc.pms4 && doc.shift === "Night") {
                        pmsMatch = true;
                    }
                } else {
                    pmsMatch = true;
                }

                // Check AGO match if values are provided
                if (ago1 && ago3) {
                    if (ago1 === doc.ago2 && ago3 === doc.ago4 && doc.shift === "Night") {
                        agoMatch = true;
                    }
                } else {
                    agoMatch = true;
                }

                // If both are found, we can break early
                if (pmsMatch && agoMatch) {
                    break;
                }
            }

            match = pmsMatch && agoMatch;
        }

        if (match) {
            toast("All indices match", "success");
        } else {
            toast("Index mismatch — correct your values before continuing.", "error");
            totalVente = undefined;
            document.getElementById("resultpms").textContent = "—";
            document.getElementById("resultago").textContent = "—";
            document.getElementById("result").textContent    = "—";
        }

    } catch (error) {
        toast("Error checking index: " + error.message, "error");
    }
}

// ── PAYMENT STATE (set by payments) ───────────────────────────
let momo, momoLoss, totalFiche, bon, spFuelCard, bankCard;
let cash5000, cash2000, cash1000, cash500;
let totalCash, totalPayments, gainPayments, listBC, listSFC, totalLoans;

async function payments() {

    // I-12: Must run calculateIndex first so totalVente is defined
    if (totalVente === undefined) {
        toast("Run Calculate Index first.", "warning");
        return;
    }

    try {
        momo = Number(document.getElementById("momo").value);
        momoLoss = Number(document.getElementById("momoLoss").value);
        bon = Number(document.getElementById("bon").value);
        cash5000 = Number(document.getElementById("5000").value);
        cash2000 = Number(document.getElementById("2000").value);
        cash1000 = Number(document.getElementById("1000").value);
        cash500 = Number(document.getElementById("500").value);
        logDate= document.getElementById("logDate").value;
        shift = document.getElementById("shift").value;

        listSFC = [...spFuelCardList];
        listBC  = [...bankCardList];

        spFuelCard = listSFC.reduce((sum, n) => sum + n, 0);
        bankCard   = listBC.reduce((sum, n) => sum + n, 0);

        totalLoans = loans.reduce((sum, loan) => sum + loan.amount, 0);
        totalFiche = fiche.reduce((sum, item) => sum + item.amount, 0);

        totalCash = (cash5000*5000) + (cash2000*2000) + (cash1000*1000) + (cash500*500);
        totalPayments = momo + momoLoss + totalFiche + bon + spFuelCard + bankCard + totalCash + totalLoans;
        gainPayments = totalPayments - totalVente;


        document.getElementById("totalLoans").textContent = `${totalLoans.toLocaleString()} RWF`;
        document.getElementById("totalFiche").textContent = `${totalFiche.toLocaleString()} RWF`;
        document.getElementById("totalPayments").textContent = `${totalPayments.toLocaleString()} RWF`;
        const gainEl = document.getElementById("gainPayments");
        gainEl.textContent = `${gainPayments.toLocaleString()} RWF`;
        gainEl.className = `output result-value ${gainPayments >= 0 ? 'gain' : 'loss'}`;
        document.getElementById("totalCash").textContent = `${totalCash.toLocaleString()} RWF`;
    } catch (error) {
        toast("Error calculating payments: " + error.message, "error");
    }
}

function validateBeforeStore() {
    logDate = document.getElementById("logDate").value;
    shift   = document.getElementById("shift").value;

    if (!logDate) { toast("Select a date before storing.", "warning"); return false; }
    if (!shift)   { toast("Select a shift before storing.", "warning"); return false; }

    if (totalVente === undefined || isNaN(totalVente)) {
        toast("Run Calculate Index first.", "warning"); return false;
    }
    if (totalPayments === undefined || isNaN(totalPayments)) {
        toast("Run Calculate Payments first.", "warning"); return false;
    }

    const fields = [
        [pmsPrice,       "PMS price (check Settings)"],
        [agoPrice,       "AGO price (check Settings)"],
        [venteLitresPms, "PMS litres"],
        [venteLitresAgo, "AGO litres"],
        [totalPms,       "Total PMS"],
        [totalAgo,       "Total AGO"],
        [momo,           "MoMo"],
        [momoLoss,       "MoMo Loss"],
        [totalCash,      "Total Cash"],
        [gainPayments,   "Gain Payments"],
    ];
    for (const [val, label] of fields) {
        if (val === undefined || val === null || isNaN(val)) {
            toast(`Invalid value for ${label} — re-run the calculations.`, "warning");
            return false;
        }
    }
    return true;
}

let dataSituation;
async function situation() {

    if (!validateBeforeStore()) return;

    try {
        const profile = await requireAuth();
        const email = profile.email;
        const employee = profile.name;
        const companyId = profile.companyId;
        const stationId = profile.stationId;
        const userId = profile.userId;
        

        const selectedDate = new Date(logDate);
        const mm   = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const yyyy = selectedDate.getFullYear();
        const monthYear = `${yyyy}-${mm}`;

        // I-4: Check for duplicate submission before writing anything
        const dupCheck = await apiFetch(`/daily-reports/me?logDate=${logDate}&email=${email}&shift=${shift}`).then(r => r.json());

        if (dupCheck.dailyReport.documents.length > 0) {
            toast("You already submitted this shift. Contact admin if a resubmission is needed.", "warning");
            return;
        }

        const gainRes = await apiFetch(`/gain-pompiste`,{
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
                companyId,
                stationId,
                userId,
                email, 
                employeeName: employee, 
                monthYear,
                logDate,
                gainKey: `${stationId}_${userId}_${monthYear}`,
                gainPayments
            }),
        })

        if (!gainRes.ok) throw new Error("Failed to save gain: " + (await gainRes.text()));

        // Shared reference ID stored on both index and payments records
        const id = `${employee}_${logDate}_${shift}`;

        const dataIndex = {
            companyId,
            stationId,
            email,
            employeeName: employee,
            shift,
            logDate,
            shiftKey: `${email}_${logDate}_${shift}`,
            pmsPrice,
            agoPrice,
            totalPms,
            totalAgo,
            totalVente,
            venteLitresPms,
            venteLitresAgo,
            pms1,
            pms2,
            pms3,
            pms4,
            ago1,
            ago2,
            ago3,
            ago4
        }

        const dataPayments = {
            companyId,
            stationId,
            momo,
            momoLoss,
            totalFiche,
            bon,
            listBC,
            listSFC,
            bankCard,
            spFuelCard,
            cash5000,
            cash2000,
            cash1000,
            cash500,
            totalCash,
            totalPayments,
            gainPayments,
            email,
            logDate,
            shift,
            employeeName: employee,
            totalLoans,
            totalVente,
            shiftKey: `${email}_${logDate}_${shift}`,
        };

        const response = await apiFetch(`/situation/me?logDate=${logDate}`).then(r => r.json());
        const sitDocs = response.situation.documents;



        // C-3: Track whether a situation document was written.
        // Index and payments must NOT be written if situation was skipped.
        let situationWritten = false;

        if (shift === "Morning") {

            if (sitDocs.length === 0) {

                dataSituation = {
                    companyId,
                    stationId,
                    situationKey: `${stationId}_${logDate}`,
                    momo,
                    momoLoss,
                    totalFiche,
                    bon,
                    spFuelCard,
                    bankCard,
                    totalCash,
                    totalLoans,
                    totalPayments,
                    gainPayments,
                    venteLitresPms,
                    totalPms,
                    venteLitresAgo,
                    totalAgo,
                    totalVente,
                    pms1,
                    pms3,
                    ago1,
                    ago3,
                    pmsPrice,
                    agoPrice,
                    logDate,
                };

                await apiFetch(`/situation`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(dataSituation),
                })

            } else {
                const doc   = sitDocs[0];
                const docId = doc.$id;

                // I-8: Build accumulated totals without mutating module-level variables
                dataSituation = {
                    momo:           momo           + (doc.momo           || 0),
                    momoLoss:       momoLoss       + (doc.momoLoss       || 0),
                    totalFiche:     totalFiche     + (doc.totalFiche     || 0),
                    bon:            bon            + (doc.bon            || 0),
                    spFuelCard:     spFuelCard     + (doc.spFuelCard     || 0),
                    bankCard:       bankCard       + (doc.bankCard       || 0),
                    totalCash:      totalCash      + (doc.totalCash      || 0),
                    totalLoans:     totalLoans     + (doc.totalLoans     || 0),
                    totalPayments:  totalPayments  + (doc.totalPayments  || 0),
                    gainPayments:   gainPayments   + (doc.gainPayments   || 0),
                    venteLitresPms: venteLitresPms + (doc.venteLitresPms || 0),
                    totalPms:       totalPms       + (doc.totalPms       || 0),
                    venteLitresAgo: venteLitresAgo + (doc.venteLitresAgo || 0),
                    totalAgo:       totalAgo       + (doc.totalAgo       || 0),
                    totalVente:     totalVente     + (doc.totalVente     || 0),
                };

                await apiFetch(`/situation/${docId}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(dataSituation)
                });
            }

            situationWritten = true;

        } else if ((shift === "Afternoon" || shift === "Evening") && sitDocs.length !== 0) {
            const doc   = sitDocs[0];
            const docId = doc.$id;

            // I-8: Accumulate without mutating module-level variables
            dataSituation = {
                momo:           momo           + (doc.momo           || 0),
                momoLoss:       momoLoss       + (doc.momoLoss       || 0),
                totalFiche:     totalFiche     + (doc.totalFiche     || 0),
                bon:            bon            + (doc.bon            || 0),
                spFuelCard:     spFuelCard     + (doc.spFuelCard     || 0),
                bankCard:       bankCard       + (doc.bankCard       || 0),
                totalCash:      totalCash      + (doc.totalCash      || 0),
                totalLoans:     totalLoans     + (doc.totalLoans     || 0),
                totalPayments:  totalPayments  + (doc.totalPayments  || 0),
                gainPayments:   gainPayments   + (doc.gainPayments   || 0),
                venteLitresPms: venteLitresPms + (doc.venteLitresPms || 0),
                totalPms:       totalPms       + (doc.totalPms       || 0),
                venteLitresAgo: venteLitresAgo + (doc.venteLitresAgo || 0),
                totalAgo:       totalAgo       + (doc.totalAgo       || 0),
                totalVente:     totalVente     + (doc.totalVente     || 0),
            };

            await apiFetch(`/situation/${docId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(dataSituation)
            });
            situationWritten = true;

        } else if (shift === "Night" && sitDocs.length !== 0) {
            const doc   = sitDocs[0];
            const docId = doc.$id;

            // Day is only fully done when both Night shift AND stocks are stored.
            // If stocks were already submitted before this Night shift, mark done now.
            // Otherwise storeStock() will set done:true once it runs.
            // const stocksStored = doc.physicalStockPms != null;

            // I-8: Accumulate without mutating module-level variables
            dataSituation = {
                momo:           momo           + (doc.momo           || 0),
                momoLoss:       momoLoss       + (doc.momoLoss       || 0),
                totalFiche:     totalFiche     + (doc.totalFiche     || 0),
                bon:            bon            + (doc.bon            || 0),
                spFuelCard:     spFuelCard     + (doc.spFuelCard     || 0),
                bankCard:       bankCard       + (doc.bankCard       || 0),
                totalCash:      totalCash      + (doc.totalCash      || 0),
                totalLoans:     totalLoans     + (doc.totalLoans     || 0),
                totalPayments:  totalPayments  + (doc.totalPayments  || 0),
                gainPayments:   gainPayments   + (doc.gainPayments   || 0),
                venteLitresPms: venteLitresPms + (doc.venteLitresPms || 0),
                totalPms:       totalPms       + (doc.totalPms       || 0),
                venteLitresAgo: venteLitresAgo + (doc.venteLitresAgo || 0),
                totalAgo:       totalAgo       + (doc.totalAgo       || 0),
                totalVente:     totalVente     + (doc.totalVente     || 0),
                pms2,
                pms4,
                ago2,
                ago4,
                done: false,
            };

            await apiFetch(`/situation/${docId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(dataSituation)
            });
            situationWritten = true;
        }

        // C-3: If no situation was written (Afternoon/Evening/Night with no Morning),
        // abort here — do not write orphaned index or payments records.
        if (!situationWritten) {
            toast(`No situation record found for ${logDate}. Submit Morning shift first.`, "error");
            return;
        }

        // C-4: Write index first, then payments. If payments fails, roll back
        // the index write so the database stays consistent and the user can retry.
        let indexDocId = null;
        try {

            const indexResponse = await apiFetch(`/daily-reports`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(dataIndex)
            })

            const indexDoc = await indexResponse.json();
            indexDocId = indexDoc.dailyReport.$id;

            await apiFetch(`/payments`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(dataPayments)
            });

        } catch (writeErr) {
            if (indexDocId) {
                // Compensate: undo the index write so the state stays clean for a retry
                try { await apiFetch(`/daily-reports/${indexDocId}`, { method: "DELETE" }); } catch {}
            }
            throw writeErr;
        }

        // Bulk-write each fiche entry to its own collection document
        const newFiche = fiche.map(item => ({
            companyId:    profile.companyId,
            stationId:    profile.stationId,
            email:        profile.email,
            employeeName: profile.name,
            shift,
            logDate,
            shiftKey:  `${profile.email}_${logDate}_${shift}`,
            plate:        item.plate,
            amount:       item.amount,
            customerId:   item.customerId  || "",
            customerName: item.company,    // old field mapped to new name
        }));

        await apiFetch(`/fiche`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(newFiche)
        });

        // Bulk-write each loan entry to its own collection document
        const enrichedLoans = loans.map(item => ({
            companyId:    profile.companyId,
            stationId:    profile.stationId,
            email:        profile.email,
            employeeName: profile.name,
            shift,
            logDate,
            monthYear,
            shiftKey:  `${profile.email}_${logDate}_${shift}`,
            plate:        item.plate,
            amount:       item.amount,
            customerId:   item.customerId  || "",
            customerName: item.company,
        }));

        await apiFetch(`/loans`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(enrichedLoans)
        })


        toast("Report saved successfully", "success");

        function clearOutputs() {
            const outputs = document.querySelectorAll(".output");
            outputs.forEach(el => { el.textContent = "0"; });

            document.getElementById("momo").value = "";
            clearFiche();
            clearLoan();

            fiche = [];
            loans = [];
            spFuelCardList = [];
            bankCardList = [];
            document.getElementById("ficheChips").innerHTML = "";
            document.getElementById("loanChips").innerHTML = "";
            document.getElementById("spFuelCardChips").innerHTML = "";
            document.getElementById("bankCardChips").innerHTML = "";
        }

        clearOutputs();

        document.getElementById("rapportForm").reset();
        document.getElementById("paymentsForm").reset();

    } catch (err) {
        if (err.message.includes("Unauthorized")) {
            toast("You must be logged in.", "error");
        } else {
            toast("Error: " + err.message, "error");
        }
    }
}

function clearFiche() {
    document.getElementById("fiche-plate").value = "";
    document.getElementById("fiche-company").value = "";
    document.getElementById("fiche-amount").value = "";
}

function clearLoan() {
    document.getElementById("loan-plate").value = "";
    document.getElementById("loan-company").value = "";
    document.getElementById("loan-amount").value = "";
}


let spFuelCardList = [];
let bankCardList = [];

function renderChips(containerId, list, removeFn) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    list.forEach((amt, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = amt.toLocaleString() + " RWF";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip-remove";
        btn.textContent = "×";
        btn.onclick = () => removeFn(i);
        chip.appendChild(btn);
        container.appendChild(chip);
    });
}

function addSpCard() {
    const input = document.getElementById("spFuelCardInput");
    const val = parseInt(input.value);
    if (!val || val <= 0) return;
    spFuelCardList.push(val);
    renderChips("spFuelCardChips", spFuelCardList, removeSpCard);
    input.value = "";
    input.focus();
}
function removeSpCard(i) {
    spFuelCardList.splice(i, 1);
    renderChips("spFuelCardChips", spFuelCardList, removeSpCard);
}

function addBankCard() {
    const input = document.getElementById("bankCardInput");
    const val = parseInt(input.value);
    if (!val || val <= 0) return;
    bankCardList.push(val);
    renderChips("bankCardChips", bankCardList, removeBankCard);
    input.value = "";
    input.focus();
}
function removeBankCard(i) {
    bankCardList.splice(i, 1);
    renderChips("bankCardChips", bankCardList, removeBankCard);
}

let fiche = [];

function renderFicheChips() {
    const container = document.getElementById("ficheChips");
    container.innerHTML = "";
    fiche.forEach((item, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        const label = [item.plate, item.company].filter(Boolean).join(" · ") + ` · ${item.amount.toLocaleString()} RWF`;
        chip.textContent = label;
        chip.style.cursor = "pointer";
        chip.title = "Click to edit";
        chip.onclick = () => editFiche(i);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip-remove";
        btn.textContent = "×";
        btn.onclick = (e) => { e.stopPropagation(); removeFiche(i); };
        chip.appendChild(btn);
        container.appendChild(chip);
    });
}

const _plateRegex = /^R[A-Z]{2}\s?\d{3}\s?[A-Z]$/;
function _normalizePlate(p) {
    const m = p.match(/^(R[A-Z]{2})\s?(\d{3})\s?([A-Z])$/);
    return m ? `${m[1]} ${m[2]} ${m[3]}` : p;
}

function addFiche() {
    const plate   = document.getElementById("fiche-plate").value.trim();
    const company = document.getElementById("fiche-company").value.trim();
    const amount  = parseInt(document.getElementById("fiche-amount").value);
    if (!plate && !company) { toast("Enter a plate or company", "warning"); return; }
    if (plate && !_plateRegex.test(plate)) { toast("Plate format must be: RAB 123A", "warning"); return; }
    if (!amount || amount <= 0) { toast("Enter a valid amount", "warning"); return; }
    fiche.push({ plate: plate ? _normalizePlate(plate) : "", company, amount });
    renderFicheChips();
    clearFiche();
    document.getElementById("fiche-amount").focus();
}

function editFiche(i) {
    const item = fiche[i];
    document.getElementById("fiche-plate").value   = item.plate;
    document.getElementById("fiche-company").value = item.company;
    document.getElementById("fiche-amount").value  = item.amount;
    fiche.splice(i, 1);
    renderFicheChips();
    document.getElementById("fiche-amount").focus();
}

function removeFiche(i) {
    fiche.splice(i, 1);
    renderFicheChips();
}

let loans = [];

function renderLoanChips() {
    const container = document.getElementById("loanChips");
    container.innerHTML = "";
    loans.forEach((item, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        const label = [item.plate, item.company].filter(Boolean).join(" · ") + ` · ${item.amount.toLocaleString()} RWF`;
        chip.textContent = label;
        chip.style.cursor = "pointer";
        chip.title = "Click to edit";
        chip.onclick = () => editLoan(i);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip-remove";
        btn.textContent = "×";
        btn.onclick = (e) => { e.stopPropagation(); removeLoan(i); };
        chip.appendChild(btn);
        container.appendChild(chip);
    });
}

function addLoan() {
    const plate   = document.getElementById("loan-plate").value.trim();
    const company = document.getElementById("loan-company").value.trim();
    const amount  = parseInt(document.getElementById("loan-amount").value);
    if (!plate && !company) { toast("Enter a plate or company", "warning"); return; }
    if (plate && !_plateRegex.test(plate)) { toast("Plate format must be: RAB 123A", "warning"); return; }
    if (!amount || amount <= 0) { toast("Enter a valid amount", "warning"); return; }
    loans.push({ plate: plate ? _normalizePlate(plate) : "", company, amount });
    renderLoanChips();
    clearLoan();
    document.getElementById("loan-amount").focus();
}

function editLoan(i) {
    const item = loans[i];
    document.getElementById("loan-plate").value   = item.plate;
    document.getElementById("loan-company").value = item.company;
    document.getElementById("loan-amount").value  = item.amount;
    loans.splice(i, 1);
    renderLoanChips();
    document.getElementById("loan-amount").focus();
}

function removeLoan(i) {
    loans.splice(i, 1);
    renderLoanChips();
}

async function MomoLoss() {
    const momo = Number(document.getElementById("momo").value);
    document.getElementById("momoLoss").value = parseInt((momo / 100) * momoFeePercent) || 0;
}
