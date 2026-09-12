import React, { useState, useEffect, useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from "recharts";

const INK = "#1E2A2E";
const PAPER = "#FAF9F4";
const LINE = "#D8D5C8";
const GROWTH = "#2F6F5E";
const CAUTION = "#B8862F";
const SPEND = "#A15A44";
const SPOUSE = "#5C6FA8";
const ASSET = "#7A5C8E";
const MUTED = "#7A786E";

const WITHDRAWAL_LABELS = {
  taxable: "Joint taxable brokerage",
  yourTraditional: "Your traditional 401k/IRA",
  spouseTraditional: "Spouse's traditional 401k/IRA",
  roth: "Joint Roth accounts",
};

const RMD_TABLE = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
  94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5
};
function rmdFactor(age) {
  if (age < 73) return null;
  if (age > 110) return 2.9;
  return RMD_TABLE[age];
}

function ssMultiplier(claimAge, fra) {
  if (claimAge === fra) return 1;
  if (claimAge < fra) {
    const monthsEarly = (fra - claimAge) * 12;
    let reduction;
    if (monthsEarly <= 36) reduction = monthsEarly * (5 / 9) / 100;
    else reduction = 36 * (5 / 9) / 100 + (monthsEarly - 36) * (5 / 12) / 100;
    return 1 - reduction;
  }
  const monthsLate = Math.min((claimAge - fra) * 12, (70 - fra) * 12);
  return 1 + monthsLate * (2 / 3) / 100;
}

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "$0";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString();
}

function deriveTimeline(inp) {
  const ageOffset = inp.spouseCurrentAge - inp.currentAge; // spouseAge = age + ageOffset
  const householdRetireAge = Math.max(inp.retirementAge, inp.spouseRetirementAge - ageOffset);
  const horizon = Math.max(inp.lifeExpectancy, inp.spouseLifeExpectancy - ageOffset);
  return { ageOffset, householdRetireAge, horizon };
}

function runProjection(inp) {
  const { ageOffset, householdRetireAge, horizon } = deriveTimeline(inp);
  const realPre = (1 + inp.preReturn / 100) / (1 + inp.inflation / 100) - 1;
  const realPost = (1 + inp.postReturn / 100) / (1 + inp.inflation / 100) - 1;

  const yourSSAnnual = inp.yourSSBenefitFRA * ssMultiplier(inp.yourSSClaimAge, inp.yourSSFRA);
  const spouseSSAnnual = inp.spouseSSBenefitFRA * ssMultiplier(inp.spouseSSClaimAge, inp.spouseSSFRA);

  const purchasesByAge = {};
  inp.majorPurchases.forEach(p => {
    purchasesByAge[p.age] = (purchasesByAge[p.age] || 0) + p.amount;
  });

  let yourTraditional = inp.yourTraditionalBalance;
  let spouseTraditional = inp.spouseTraditionalBalance;
  let taxable = inp.taxableBalance;
  let roth = inp.rothBalance;

  function drawFrom(need) {
    const getters = {
      taxable: () => taxable,
      yourTraditional: () => yourTraditional,
      spouseTraditional: () => spouseTraditional,
      roth: () => roth,
    };
    const setters = {
      taxable: v => { taxable = v; },
      yourTraditional: v => { yourTraditional = v; },
      spouseTraditional: v => { spouseTraditional = v; },
      roth: v => { roth = v; },
    };
    let remaining = need;
    for (const key of inp.withdrawalOrder) {
      if (remaining <= 0) break;
      const avail = getters[key]();
      const draw = Math.min(avail, remaining);
      setters[key](avail - draw);
      remaining -= draw;
    }
    return need - remaining;
  }

  const rows = [];
  let depletionAge = null;

  for (let age = inp.currentAge; age <= horizon; age++) {
    const spouseAge = age + ageOffset;
    const accumulating = age < householdRetireAge;
    let yourRmd = 0, spouseRmd = 0, ssIncome = 0, withdrawal = 0;

    if (accumulating) {
      const yourTradContributing = age < inp.retirementAge;
      const spouseTradContributing = spouseAge < inp.spouseRetirementAge;
      yourTraditional = yourTraditional * (1 + realPre) + (yourTradContributing ? inp.yourTraditionalMonthly * 12 : 0);
      spouseTraditional = spouseTraditional * (1 + realPre) + (spouseTradContributing ? inp.spouseTraditionalMonthly * 12 : 0);
      taxable = taxable * (1 + realPre) + inp.taxableMonthly * 12;
      roth = roth * (1 + realPre) + inp.rothMonthly * 12;
    } else {
      yourTraditional *= (1 + realPost);
      spouseTraditional *= (1 + realPost);
      taxable *= (1 + realPost);
      roth *= (1 + realPost);

      const yourFactor = rmdFactor(age);
      const spouseFactor = rmdFactor(spouseAge);
      yourRmd = yourFactor ? yourTraditional / yourFactor : 0;
      spouseRmd = spouseFactor ? spouseTraditional / spouseFactor : 0;
      yourTraditional -= yourRmd;
      spouseTraditional -= spouseRmd;
      const totalRmd = yourRmd + spouseRmd;
      withdrawal += totalRmd;

      const yourSS = age >= inp.yourSSClaimAge ? yourSSAnnual : 0;
      const spouseSS = spouseAge >= inp.spouseSSClaimAge ? spouseSSAnnual : 0;
      ssIncome = yourSS + spouseSS;

      const need = Math.max(0, inp.annualSpending - ssIncome);
      const netNeed = need - totalRmd;

      if (netNeed > 0) {
        withdrawal += drawFrom(netNeed);
      } else {
        taxable += -netNeed;
      }
    }

    const purchaseAmount = purchasesByAge[age] || 0;
    let purchaseFunded = 0;
    if (purchaseAmount > 0) {
      purchaseFunded = drawFrom(purchaseAmount);
      withdrawal += purchaseFunded;
    }

    yourTraditional = Math.max(0, yourTraditional);
    spouseTraditional = Math.max(0, spouseTraditional);
    taxable = Math.max(0, taxable);
    roth = Math.max(0, roth);

    const netWorth = yourTraditional + spouseTraditional + taxable + roth;
    if (netWorth <= 0 && depletionAge === null && age >= householdRetireAge) {
      depletionAge = age;
    }

    rows.push({
      age, spouseAge,
      yourTraditional: Math.round(yourTraditional), spouseTraditional: Math.round(spouseTraditional),
      taxable: Math.round(taxable), roth: Math.round(roth), netWorth: Math.round(netWorth),
      yourRmd: Math.round(yourRmd), spouseRmd: Math.round(spouseRmd), rmd: Math.round(yourRmd + spouseRmd),
      ssIncome: Math.round(ssIncome), withdrawal: Math.round(withdrawal),
      purchaseAmount: Math.round(purchaseAmount), purchaseShortfall: Math.round(purchaseAmount - purchaseFunded)
    });
  }
  return { rows, depletionAge, yourSSAnnual, spouseSSAnnual, ageOffset, householdRetireAge, horizon };
}

function run529Projection(plan, inp) {
  const { horizon } = deriveTimeline(inp);
  const realReturn = (1 + plan.returnRate / 100) / (1 + inp.inflation / 100) - 1;
  let balance = plan.balance;
  const rows = [];
  const withdrawEnd = plan.withdrawStartAge + plan.withdrawYears - 1;
  let depletedEarly = false;

  for (let age = inp.currentAge; age <= horizon; age++) {
    const contributing = age < plan.withdrawStartAge;
    balance = balance * (1 + realReturn) + (contributing ? plan.monthly * 12 : 0);

    let withdrawal = 0;
    if (age >= plan.withdrawStartAge && age <= withdrawEnd) {
      withdrawal = Math.min(balance, plan.annualWithdrawal);
      if (withdrawal < plan.annualWithdrawal) depletedEarly = true;
      balance -= withdrawal;
    }
    balance = Math.max(0, balance);
    rows.push({ age, balance: Math.round(balance), withdrawal: Math.round(withdrawal) });
  }
  return { rows, withdrawEnd, depletedEarly };
}

function runHouseProjection(inp) {
  const { horizon } = deriveTimeline(inp);
  const monthlyRate = inp.house.mortgageRate / 100 / 12;
  let nominalValue = inp.house.value;
  let mortgage = inp.house.mortgageBalance;
  const rows = [];
  let payoffAge = null;
  let yearIndex = 0;

  for (let age = inp.currentAge; age <= horizon; age++) {
    nominalValue = nominalValue * (1 + inp.house.appreciationRate / 100);
    for (let m = 0; m < 12; m++) {
      if (mortgage <= 0) break;
      const interest = mortgage * monthlyRate;
      let principal = inp.house.mortgagePayment - interest;
      if (principal < 0) principal = 0;
      mortgage -= principal;
      if (mortgage < 0) mortgage = 0;
    }
    if (mortgage <= 0 && payoffAge === null) payoffAge = age;
    yearIndex += 1;
    const deflator = Math.pow(1 + inp.inflation / 100, yearIndex);
    const realValue = nominalValue / deflator;
    const realMortgage = mortgage / deflator;
    rows.push({ age, value: Math.round(realValue), mortgage: Math.round(realMortgage), equity: Math.round(realValue - realMortgage) });
  }
  return { rows, payoffAge };
}

function runVehicleProjection(vehicle, inp) {
  const { horizon } = deriveTimeline(inp);
  let value = vehicle.currentValue;
  const rows = [];
  for (let age = inp.currentAge; age <= horizon; age++) {
    value = value * (1 - vehicle.depreciationRate / 100);
    if (value < 0) value = 0;
    rows.push({ age, value: Math.round(value) });
  }
  return { rows };
}

function buildMilestones(inp, firstRmdAge, housePayoffAge) {
  const { ageOffset, horizon } = deriveTimeline(inp);
  const items = [
    { age: 65, label: "You: Medicare eligibility", detail: "Coverage gap ends if retiring earlier", color: MUTED },
    { age: 65 - ageOffset, label: "Spouse: Medicare eligibility", detail: "Coverage gap ends if retiring earlier", color: MUTED },
    { age: inp.retirementAge, label: "You retire", detail: "Your contributions stop", color: CAUTION },
    { age: inp.spouseRetirementAge - ageOffset, label: "Spouse retires", detail: "Spouse's contributions stop", color: CAUTION },
    { age: inp.yourSSClaimAge, label: "You claim Social Security", detail: "Your guaranteed income starts", color: GROWTH },
    { age: inp.spouseSSClaimAge - ageOffset, label: "Spouse claims Social Security", detail: "Spouse's guaranteed income starts", color: SPOUSE },
    { age: 73, label: "Your first RMD", detail: "Forced withdrawal from your traditional account", color: CAUTION },
    { age: 73 - ageOffset, label: "Spouse's first RMD", detail: "Forced withdrawal from spouse's traditional account", color: SPOUSE },
    { age: horizon, label: "Planning horizon", detail: "Later of the two life expectancies", color: MUTED },
  ];
  if (housePayoffAge) {
    items.push({ age: housePayoffAge, label: "Mortgage paid off", detail: "House becomes unencumbered", color: ASSET });
  }
  inp.plan529s.forEach((plan, i) => {
    items.push({
      age: plan.withdrawStartAge,
      label: (plan.name || "529 plan " + (i + 1)) + " withdrawals begin",
      detail: plan.withdrawYears + " years of education funding",
      color: SPEND,
    });
  });
  inp.majorPurchases.forEach((p) => {
    items.push({ age: p.age, label: p.name || "Major purchase", detail: fmt(p.amount) + " withdrawal", color: ASSET });
  });
  return items.filter(m => m.age >= inp.currentAge && m.age <= horizon).sort((a, b) => a.age - b.age);
}

function ssComparison(fra, benefitFRA, lifeExpectancy) {
  const ages = [62, fra, 70];
  return ages.map(claimAge => {
    const mult = ssMultiplier(claimAge, fra);
    const annual = benefitFRA * mult;
    const cumulative = [];
    let total = 0;
    for (let age = 62; age <= lifeExpectancy; age++) {
      if (age >= claimAge) total += annual;
      cumulative.push({ age, total: Math.round(total) });
    }
    return { claimAge, annual: Math.round(annual), cumulative };
  });
}

function Field({ label, value, onChange, suffix, step = 1000, min = 0 }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12.5, color: MUTED, marginBottom: 4, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: "100%", padding: "7px 9px", fontSize: 14.5,
            border: `1px solid ${LINE}`, borderRadius: 3,
            background: "#fff", color: INK, fontVariantNumeric: "tabular-nums"
          }}
        />
        {suffix && <span style={{ fontSize: 12.5, color: MUTED, minWidth: 18 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function SliderField({ label, value, onChange, min, max, step = 1, suffix = "" }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <label style={{ fontSize: 12.5, color: MUTED, fontFamily: "Georgia, serif", fontStyle: "italic" }}>
          {label}
        </label>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: INK, fontVariantNumeric: "tabular-nums" }}>
          {value}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: GROWTH, cursor: "pointer" }}
      />
    </div>
  );
}

function SectionTitle({ children, accent }) {
  return (
    <h3 style={{
      fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 19,
      color: accent || INK, margin: "0 0 12px 0", borderBottom: `1px solid ${LINE}`,
      paddingBottom: 8
    }}>
      {children}
    </h3>
  );
}

function StatLine({ label, value, accent }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "8px 0", borderBottom: `1px solid ${LINE}`
    }}>
      <span style={{ fontSize: 13, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 500, color: accent || INK, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

const STORAGE_KEY = "retirement-planner-inputs";

const DEFAULT_INPUTS = {
  currentAge: 45,
  retirementAge: 65,
  lifeExpectancy: 95,
  spouseCurrentAge: 43,
  spouseRetirementAge: 63,
  spouseLifeExpectancy: 97,

  yourTraditionalBalance: 350000,
  yourTraditionalMonthly: 900,
  spouseTraditionalBalance: 200000,
  spouseTraditionalMonthly: 700,

  taxableBalance: 150000,
  taxableMonthly: 500,
  rothBalance: 120000,
  rothMonthly: 500,

  preReturn: 7,
  postReturn: 5,
  inflation: 3,
  annualSpending: 110000,

  yourSSFRA: 67,
  yourSSBenefitFRA: 32000,
  yourSSClaimAge: 67,
  spouseSSFRA: 67,
  spouseSSBenefitFRA: 24000,
  spouseSSClaimAge: 67,

  plan529s: [
    { name: "Child 1", balance: 40000, monthly: 300, returnRate: 6, withdrawStartAge: 63, withdrawYears: 4, annualWithdrawal: 30000 },
    { name: "Child 2", balance: 25000, monthly: 300, returnRate: 6, withdrawStartAge: 66, withdrawYears: 4, annualWithdrawal: 30000 },
  ],

  house: {
    value: 450000,
    appreciationRate: 3.5,
    mortgageBalance: 280000,
    mortgageRate: 6.5,
    mortgagePayment: 2200,
  },
  vehicles: [
    { name: "Car 1", currentValue: 28000, depreciationRate: 15 },
  ],
  majorPurchases: [
    { name: "New car", age: 50, amount: 40000 },
  ],
  withdrawalOrder: ["taxable", "yourTraditional", "spouseTraditional", "roth"],
};

export default function RetirementPlanner() {
  const [inp, setInp] = useState(DEFAULT_INPUTS);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [tab, setTab] = useState("inputs");
  const [showBackup, setShowBackup] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [lookupAge, setLookupAge] = useState(76);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY, false);
        if (!cancelled && result && result.value) {
          const parsed = JSON.parse(result.value);
          setInp(prev => ({ ...prev, ...parsed }));
        }
      } catch (err) {
        // no saved data yet, or storage unavailable — fall back to defaults, but note why
        if (!cancelled && err && err.message && !/not found|no such key/i.test(err.message)) {
          setSaveError("Load error: " + err.message);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaveStatus("saving");
    const timeout = setTimeout(async () => {
      try {
        const result = await window.storage.set(STORAGE_KEY, JSON.stringify(inp), false);
        setSaveStatus(result ? "saved" : "error");
        if (!result) setSaveError("Storage returned no result");
      } catch (err) {
        setSaveStatus("error");
        setSaveError(err && err.message ? err.message : "Unknown storage error");
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [inp, loaded]);

  function resetDefaults() {
    setInp(DEFAULT_INPUTS);
  }

  function loadImportedSettings() {
    try {
      const parsed = JSON.parse(importText);
      setInp(prev => ({ ...prev, ...parsed }));
      setImportMsg("Loaded.");
    } catch (err) {
      setImportMsg("Couldn't parse that — check it's valid JSON copied from this tool.");
    }
  }

  const set = (key) => (val) => setInp(prev => ({ ...prev, [key]: val }));
  const setHouse = (key) => (val) => setInp(prev => ({ ...prev, house: { ...prev.house, [key]: val } }));

  const projection = useMemo(() => runProjection(inp), [inp]);
  const plan529Results = useMemo(
    () => inp.plan529s.map(plan => run529Projection(plan, inp)),
    [inp]
  );
  const houseProjection = useMemo(() => runHouseProjection(inp), [inp]);
  const vehicleResults = useMemo(
    () => inp.vehicles.map(v => runVehicleProjection(v, inp)),
    [inp]
  );
  const ssComp = useMemo(() => ({
    you: ssComparison(inp.yourSSFRA, inp.yourSSBenefitFRA, inp.lifeExpectancy),
    spouse: ssComparison(inp.spouseSSFRA, inp.spouseSSBenefitFRA, inp.spouseLifeExpectancy),
  }), [inp]);

  const firstRmdRow = projection.rows.find(r => r.rmd > 0);
  const retirementRow = projection.rows.find(r => r.age === Math.max(inp.retirementAge, inp.spouseRetirementAge - projection.ageOffset));
  const finalRow = projection.rows[projection.rows.length - 1];
  const rmdSchedule = projection.rows.filter(r => r.rmd > 0).slice(0, 15);

  const totalNetWorthRows = useMemo(() => {
    return projection.rows.map((row, i) => {
      const equity = (houseProjection.rows[i] || {}).equity || 0;
      const vehiclesTotal = vehicleResults.reduce((sum, v) => sum + ((v.rows[i] || {}).value || 0), 0);
      return { age: row.age, liquid: row.netWorth, equity, vehicles: vehiclesTotal, total: row.netWorth + equity + vehiclesTotal };
    });
  }, [projection, houseProjection, vehicleResults]);

  const milestones = useMemo(
    () => buildMilestones(inp, firstRmdRow ? firstRmdRow.age : null, houseProjection.payoffAge),
    [inp, firstRmdRow, houseProjection]
  );

  function setPlan529Field(index, key, value) {
    setInp(prev => {
      const plans = prev.plan529s.map((p, i) => i === index ? { ...p, [key]: value } : p);
      return { ...prev, plan529s: plans };
    });
  }
  function addPlan529() {
    setInp(prev => ({
      ...prev,
      plan529s: [...prev.plan529s, {
        name: "Child " + (prev.plan529s.length + 1), balance: 0, monthly: 200,
        returnRate: 6, withdrawStartAge: prev.retirementAge, withdrawYears: 4, annualWithdrawal: 25000
      }]
    }));
  }
  function removePlan529(index) {
    setInp(prev => ({ ...prev, plan529s: prev.plan529s.filter((_, i) => i !== index) }));
  }

  function setVehicleField(index, key, value) {
    setInp(prev => {
      const vehicles = prev.vehicles.map((v, i) => i === index ? { ...v, [key]: value } : v);
      return { ...prev, vehicles };
    });
  }
  function addVehicle() {
    setInp(prev => ({
      ...prev,
      vehicles: [...prev.vehicles, { name: "Car " + (prev.vehicles.length + 1), currentValue: 25000, depreciationRate: 15 }]
    }));
  }
  function removeVehicle(index) {
    setInp(prev => ({ ...prev, vehicles: prev.vehicles.filter((_, i) => i !== index) }));
  }

  function setPurchaseField(index, key, value) {
    setInp(prev => {
      const purchases = prev.majorPurchases.map((p, i) => i === index ? { ...p, [key]: value } : p);
      return { ...prev, majorPurchases: purchases };
    });
  }
  function addPurchase() {
    setInp(prev => ({
      ...prev,
      majorPurchases: [...prev.majorPurchases, { name: "Major purchase", age: prev.currentAge + 5, amount: 20000 }]
    }));
  }
  function removePurchase(index) {
    setInp(prev => ({ ...prev, majorPurchases: prev.majorPurchases.filter((_, i) => i !== index) }));
  }

  function moveWithdrawalOrder(index, direction) {
    setInp(prev => {
      const order = [...prev.withdrawalOrder];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= order.length) return prev;
      [order[index], order[newIndex]] = [order[newIndex], order[index]];
      return { ...prev, withdrawalOrder: order };
    });
  }
  function setWithdrawalPreset(order) {
    setInp(prev => ({ ...prev, withdrawalOrder: order }));
  }

  const tabs = [
    { id: "inputs", label: "Inputs" },
    { id: "forecast", label: "Net worth" },
    { id: "assets", label: "Assets" },
    { id: "rmd", label: "RMDs" },
    { id: "ss", label: "Social Security" },
    { id: "529", label: "529 plans" },
    { id: "milestones", label: "Milestones" },
    { id: "insights", label: "Insights" },
  ];

  return (
    <div style={{
      fontFamily: "Helvetica Neue, Arial, sans-serif", background: PAPER,
      color: INK, padding: "20px 16px", maxWidth: 720, margin: "0 auto",
      lineHeight: 1.5
    }}>
      <div style={{ marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 26, margin: 0 }}>
            Retirement ledger
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: "4px 0 0 0" }}>
            Figures in today's purchasing power. Ages shown are yours unless labeled "Spouse."
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11.5, color: saveStatus === "error" ? SPEND : MUTED }}>
            {saveStatus === "saving" && "Saving..."}
            {saveStatus === "saved" && "Saved on this device"}
            {saveStatus === "error" && "Couldn't save"}
            {saveStatus === "idle" && "\u00A0"}
          </div>
          {saveError && (
            <div style={{ fontSize: 10.5, color: SPEND, maxWidth: 220 }}>{saveError}</div>
          )}
          <button
            onClick={resetDefaults}
            style={{
              marginTop: 4, fontSize: 11.5, background: "transparent", color: MUTED,
              border: `1px solid ${LINE}`, borderRadius: 3, padding: "3px 8px", cursor: "pointer"
            }}
          >
            Reset to defaults
          </button>
          <button
            onClick={() => setShowBackup(s => !s)}
            style={{
              marginTop: 4, marginLeft: 6, fontSize: 11.5, background: "transparent", color: MUTED,
              border: `1px solid ${LINE}`, borderRadius: 3, padding: "3px 8px", cursor: "pointer"
            }}
          >
            {showBackup ? "Hide backup" : "Backup / restore"}
          </button>
        </div>
      </div>

      {showBackup && (
        <div style={{ marginBottom: 20, padding: 12, border: `1px solid ${LINE}`, borderRadius: 4, background: "#fff" }}>
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 8px 0" }}>
            Since auto-save isn't reliable in every environment, copy this text somewhere safe (notes app, email to yourself) so you can restore your numbers if needed.
          </p>
          <textarea
            readOnly
            value={JSON.stringify(inp, null, 2)}
            onClick={e => e.target.select()}
            style={{ width: "100%", height: 100, fontSize: 11, fontFamily: "monospace", border: `1px solid ${LINE}`, borderRadius: 3, padding: 8, marginBottom: 10, boxSizing: "border-box" }}
          />
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 6px 0" }}>Paste previously-copied text here to restore it:</p>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder="Paste your saved JSON here..."
            style={{ width: "100%", height: 80, fontSize: 11, fontFamily: "monospace", border: `1px solid ${LINE}`, borderRadius: 3, padding: 8, marginBottom: 8, boxSizing: "border-box" }}
          />
          <button
            onClick={loadImportedSettings}
            style={{ fontSize: 12.5, color: GROWTH, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: "5px 10px", cursor: "pointer" }}
          >
            Load pasted settings
          </button>
          {importMsg && <span style={{ fontSize: 11.5, color: MUTED, marginLeft: 10 }}>{importMsg}</span>}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginBottom: 20, borderBottom: `1px solid ${LINE}` }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 12px", fontSize: 13.5, border: "none",
              background: "transparent", cursor: "pointer",
              color: tab === t.id ? INK : MUTED,
              borderBottom: tab === t.id ? `2px solid ${GROWTH}` : "2px solid transparent",
              fontWeight: tab === t.id ? 500 : 400
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "inputs" && (
        <div>
          <SectionTitle>You</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Current age" value={inp.currentAge} onChange={set("currentAge")} step={1} />
            <Field label="Life expectancy" value={inp.lifeExpectancy} onChange={set("lifeExpectancy")} step={1} />
          </div>
          <SliderField label="Retirement age" value={inp.retirementAge} onChange={set("retirementAge")} min={inp.currentAge + 1} max={80} step={1} />
          <SliderField label="Social Security claiming age" value={inp.yourSSClaimAge} onChange={set("yourSSClaimAge")} min={62} max={70} step={1} />

          <SectionTitle accent={SPOUSE}>Spouse</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Current age" value={inp.spouseCurrentAge} onChange={set("spouseCurrentAge")} step={1} />
            <Field label="Life expectancy" value={inp.spouseLifeExpectancy} onChange={set("spouseLifeExpectancy")} step={1} />
          </div>
          <SliderField label="Retirement age" value={inp.spouseRetirementAge} onChange={set("spouseRetirementAge")} min={inp.spouseCurrentAge + 1} max={80} step={1} />
          <SliderField label="Social Security claiming age" value={inp.spouseSSClaimAge} onChange={set("spouseSSClaimAge")} min={62} max={70} step={1} />

          <SectionTitle>Your traditional 401k / IRA</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Current balance" value={inp.yourTraditionalBalance} onChange={set("yourTraditionalBalance")} suffix="$" />
            <Field label="Monthly contribution" value={inp.yourTraditionalMonthly} onChange={set("yourTraditionalMonthly")} suffix="$" step={50} />
          </div>

          <SectionTitle accent={SPOUSE}>Spouse's traditional 401k / IRA</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Current balance" value={inp.spouseTraditionalBalance} onChange={set("spouseTraditionalBalance")} suffix="$" />
            <Field label="Monthly contribution" value={inp.spouseTraditionalMonthly} onChange={set("spouseTraditionalMonthly")} suffix="$" step={50} />
          </div>

          <SectionTitle>Joint accounts</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Taxable brokerage" value={inp.taxableBalance} onChange={set("taxableBalance")} suffix="$" />
            <Field label="Taxable — monthly" value={inp.taxableMonthly} onChange={set("taxableMonthly")} suffix="$" step={50} />
            <Field label="Combined Roth balance" value={inp.rothBalance} onChange={set("rothBalance")} suffix="$" />
            <Field label="Combined Roth — monthly" value={inp.rothMonthly} onChange={set("rothMonthly")} suffix="$" step={50} />
          </div>
          <p style={{ fontSize: 12, color: MUTED, marginTop: -8 }}>
            Roth and taxable accounts are modeled jointly since Roth has no RMDs. Traditional accounts are split because RMDs are calculated per individual.
          </p>

          <SectionTitle>Growth assumptions (shared)</SectionTitle>
          <SliderField label="Pre-retirement return" value={inp.preReturn} onChange={set("preReturn")} min={0} max={12} step={0.5} suffix="%" />
          <SliderField label="Post-retirement return" value={inp.postReturn} onChange={set("postReturn")} min={0} max={10} step={0.5} suffix="%" />
          <SliderField label="Inflation" value={inp.inflation} onChange={set("inflation")} min={0} max={6} step={0.25} suffix="%" />

          <SectionTitle>Household spending</SectionTitle>
          <SliderField label="Annual spending (today's $)" value={inp.annualSpending} onChange={set("annualSpending")} min={20000} max={300000} step={2500} suffix="" />

          <SectionTitle>Your Social Security</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Full-benefit age" value={inp.yourSSFRA} onChange={set("yourSSFRA")} step={1} />
            <Field label="Benefit at full age (annual)" value={inp.yourSSBenefitFRA} onChange={set("yourSSBenefitFRA")} suffix="$" />
          </div>

          <SectionTitle accent={SPOUSE}>Spouse's Social Security</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Full-benefit age" value={inp.spouseSSFRA} onChange={set("spouseSSFRA")} step={1} />
            <Field label="Benefit at full age (annual)" value={inp.spouseSSBenefitFRA} onChange={set("spouseSSBenefitFRA")} suffix="$" />
          </div>

          <SectionTitle accent={ASSET}>House</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Field label="Current value" value={inp.house.value} onChange={setHouse("value")} suffix="$" />
            <Field label="Mortgage balance" value={inp.house.mortgageBalance} onChange={setHouse("mortgageBalance")} suffix="$" />
            <Field label="Monthly mortgage payment" value={inp.house.mortgagePayment} onChange={setHouse("mortgagePayment")} suffix="$" step={50} />
          </div>
          <SliderField label="Home appreciation rate" value={inp.house.appreciationRate} onChange={setHouse("appreciationRate")} min={0} max={8} step={0.25} suffix="%" />
          <SliderField label="Mortgage interest rate" value={inp.house.mortgageRate} onChange={setHouse("mortgageRate")} min={0} max={10} step={0.25} suffix="%" />
          <p style={{ fontSize: 12, color: MUTED, marginTop: -8 }}>
            Mortgage payments are assumed to come from income, not from the investment accounts modeled here.
          </p>

          <SectionTitle accent={ASSET}>Vehicles</SectionTitle>
          {inp.vehicles.map((v, i) => (
            <div key={i} style={{ marginBottom: 14, paddingBottom: 10, borderBottom: i < inp.vehicles.length - 1 ? `1px dashed ${LINE}` : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <input
                  type="text"
                  value={v.name}
                  onChange={e => setVehicleField(i, "name", e.target.value)}
                  style={{
                    fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, border: "none",
                    background: "transparent", color: INK, padding: "2px 0", borderBottom: `1px solid ${LINE}`
                  }}
                />
                {inp.vehicles.length > 1 && (
                  <button onClick={() => removeVehicle(i)} style={{ fontSize: 11.5, color: SPEND, background: "transparent", border: "none", cursor: "pointer" }}>
                    Remove
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                <Field label="Current value" value={v.currentValue} onChange={val => setVehicleField(i, "currentValue", val)} suffix="$" step={500} />
                <div>
                  <SliderField label="Depreciation rate" value={v.depreciationRate} onChange={val => setVehicleField(i, "depreciationRate", val)} min={0} max={30} step={1} suffix="%" />
                </div>
              </div>
            </div>
          ))}
          <button onClick={addVehicle} style={{ fontSize: 12.5, color: GROWTH, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: "5px 10px", cursor: "pointer" }}>
            + Add another vehicle
          </button>

          <div style={{ marginTop: 22 }}>
            <SectionTitle accent={ASSET}>Major purchases (portfolio withdrawals)</SectionTitle>
            <p style={{ fontSize: 12, color: MUTED, marginTop: -6 }}>
              One-time lump-sum withdrawals from the investment accounts, e.g. a replacement car in 5 years.
            </p>
            {inp.majorPurchases.map((p, i) => (
              <div key={i} style={{ marginBottom: 14, paddingBottom: 10, borderBottom: i < inp.majorPurchases.length - 1 ? `1px dashed ${LINE}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <input
                    type="text"
                    value={p.name}
                    onChange={e => setPurchaseField(i, "name", e.target.value)}
                    style={{
                      fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, border: "none",
                      background: "transparent", color: INK, padding: "2px 0", borderBottom: `1px solid ${LINE}`
                    }}
                  />
                  <button onClick={() => removePurchase(i)} style={{ fontSize: 11.5, color: SPEND, background: "transparent", border: "none", cursor: "pointer" }}>
                    Remove
                  </button>
                </div>
                <Field label="Amount" value={p.amount} onChange={val => setPurchaseField(i, "amount", val)} suffix="$" step={500} />
                <SliderField label="Your age at purchase" value={p.age} onChange={val => setPurchaseField(i, "age", val)} min={inp.currentAge} max={inp.currentAge + 40} step={1} />
              </div>
            ))}
            <button onClick={addPurchase} style={{ fontSize: 12.5, color: GROWTH, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: "5px 10px", cursor: "pointer" }}>
              + Add another purchase
            </button>
          </div>

          <div style={{ marginTop: 22 }}>
            <SectionTitle>Withdrawal strategy</SectionTitle>
            <p style={{ fontSize: 12, color: MUTED, marginTop: -6 }}>
              RMDs are always taken first once age-eligible — that's required by law. Everything else draws in the order below, top to bottom, until spending or a major purchase is covered.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button onClick={() => setWithdrawalPreset(["taxable", "yourTraditional", "spouseTraditional", "roth"])}
                style={{ fontSize: 11.5, background: "transparent", color: GROWTH, border: `1px solid ${LINE}`, borderRadius: 3, padding: "4px 9px", cursor: "pointer" }}>
                Tax-efficient (default)
              </button>
              <button onClick={() => setWithdrawalPreset(["roth", "taxable", "yourTraditional", "spouseTraditional"])}
                style={{ fontSize: 11.5, background: "transparent", color: GROWTH, border: `1px solid ${LINE}`, borderRadius: 3, padding: "4px 9px", cursor: "pointer" }}>
                Roth first
              </button>
              <button onClick={() => setWithdrawalPreset(["yourTraditional", "spouseTraditional", "taxable", "roth"])}
                style={{ fontSize: 11.5, background: "transparent", color: GROWTH, border: `1px solid ${LINE}`, borderRadius: 3, padding: "4px 9px", cursor: "pointer" }}>
                Traditional first
              </button>
            </div>
            {inp.withdrawalOrder.map((key, i) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${LINE}` }}>
                <div style={{
                  minWidth: 22, height: 22, borderRadius: 3, background: INK, color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12
                }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1, fontSize: 14 }}>{WITHDRAWAL_LABELS[key]}</div>
                <button onClick={() => moveWithdrawalOrder(i, -1)} disabled={i === 0}
                  style={{ fontSize: 13, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: "2px 8px", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1 }}>
                  ↑
                </button>
                <button onClick={() => moveWithdrawalOrder(i, 1)} disabled={i === inp.withdrawalOrder.length - 1}
                  style={{ fontSize: 13, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: "2px 8px", cursor: i === inp.withdrawalOrder.length - 1 ? "default" : "pointer", opacity: i === inp.withdrawalOrder.length - 1 ? 0.35 : 1 }}>
                  ↓
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22 }}>
            <SectionTitle>529 education plans</SectionTitle>
            {inp.plan529s.map((plan, i) => (
              <div key={i} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: i < inp.plan529s.length - 1 ? `1px dashed ${LINE}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <input
                    type="text"
                    value={plan.name}
                    onChange={e => setPlan529Field(i, "name", e.target.value)}
                    style={{
                      fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 15, border: "none",
                      background: "transparent", color: INK, padding: "2px 0", borderBottom: `1px solid ${LINE}`
                    }}
                  />
                  {inp.plan529s.length > 1 && (
                    <button onClick={() => removePlan529(i)} style={{ fontSize: 11.5, color: SPEND, background: "transparent", border: "none", cursor: "pointer" }}>
                      Remove
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
                  <Field label="Current balance" value={plan.balance} onChange={v => setPlan529Field(i, "balance", v)} suffix="$" />
                  <Field label="Monthly contribution" value={plan.monthly} onChange={v => setPlan529Field(i, "monthly", v)} suffix="$" step={50} />
                  <Field label="Withdrawal duration (years)" value={plan.withdrawYears} onChange={v => setPlan529Field(i, "withdrawYears", v)} step={1} min={1} />
                  <Field label="Annual withdrawal amount" value={plan.annualWithdrawal} onChange={v => setPlan529Field(i, "annualWithdrawal", v)} suffix="$" />
                </div>
                <SliderField label="Expected return" value={plan.returnRate} onChange={v => setPlan529Field(i, "returnRate", v)} min={0} max={10} step={0.5} suffix="%" />
                <SliderField label="Withdrawals start at your age" value={plan.withdrawStartAge} onChange={v => setPlan529Field(i, "withdrawStartAge", v)} min={inp.currentAge} max={inp.currentAge + 40} step={1} />
              </div>
            ))}
            <button onClick={addPlan529} style={{ fontSize: 12.5, color: GROWTH, background: "transparent", border: `1px solid ${LINE}`, borderRadius: 3, padding: "5px 10px", cursor: "pointer" }}>
              + Add another 529
            </button>
          </div>
        </div>
      )}

      {tab === "forecast" && (
        <div>
          <SectionTitle>Liquid net worth over time</SectionTitle>
          <p style={{ fontSize: 12, color: MUTED, marginTop: -6 }}>X-axis is your age. Investment accounts only — see Assets for house and vehicles.</p>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={projection.rows} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="age" tick={{ fontSize: 11, fill: MUTED }} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                <Tooltip formatter={(v, name) => [fmt(v), name]} labelFormatter={a => "Your age " + a} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine x={inp.retirementAge} stroke={CAUTION} strokeDasharray="3 3" label={{ value: "You retire", fontSize: 10, fill: CAUTION }} />
                <ReferenceLine x={inp.spouseRetirementAge - projection.ageOffset} stroke={SPOUSE} strokeDasharray="3 3" label={{ value: "Spouse retires", fontSize: 10, fill: SPOUSE }} />
                <Area type="monotone" dataKey="yourTraditional" stackId="1" stroke={GROWTH} fill={GROWTH} fillOpacity={0.35} name="Your traditional" />
                <Area type="monotone" dataKey="spouseTraditional" stackId="1" stroke={SPOUSE} fill={SPOUSE} fillOpacity={0.35} name="Spouse traditional" />
                <Area type="monotone" dataKey="taxable" stackId="1" stroke={CAUTION} fill={CAUTION} fillOpacity={0.35} name="Taxable" />
                <Area type="monotone" dataKey="roth" stackId="1" stroke={SPEND} fill={SPEND} fillOpacity={0.35} name="Roth" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 16 }}>
            <StatLine label="Net worth once both have retired" value={fmt(retirementRow ? retirementRow.netWorth : 0)} />
            <StatLine label={"Net worth at planning horizon (your age " + projection.horizon + ")"} value={fmt(finalRow ? finalRow.netWorth : 0)} />
            <StatLine
              label="Portfolio depletion"
              value={projection.depletionAge ? "Your age " + projection.depletionAge : "Not depleted"}
              accent={projection.depletionAge ? SPEND : GROWTH}
            />
          </div>

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${LINE}` }}>
            <SectionTitle>Check a specific age</SectionTitle>
            <SliderField label="Your age" value={lookupAge} onChange={setLookupAge} min={inp.currentAge} max={projection.horizon} step={1} />
            {(() => {
              const row = projection.rows.find(r => r.age === lookupAge);
              if (!row) return null;
              return (
                <div>
                  <StatLine label="Total withdrawn this year" value={fmt(row.withdrawal)} accent={SPEND} />
                  <StatLine label="Of which RMD (forced)" value={fmt(row.rmd)} />
                  <StatLine label="Social Security received" value={fmt(row.ssIncome)} />
                  <StatLine label="Net worth at this age" value={fmt(row.netWorth)} />
                  {row.purchaseAmount > 0 && (
                    <StatLine label="Includes major purchase" value={fmt(row.purchaseAmount)} accent={ASSET} />
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {tab === "assets" && (
        <div>
          <SectionTitle accent={ASSET}>House equity</SectionTitle>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <AreaChart data={houseProjection.rows} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="age" tick={{ fontSize: 11, fill: MUTED }} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={a => "Your age " + a} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="equity" stroke={ASSET} fill={ASSET} fillOpacity={0.35} name="Equity" />
                <Area type="monotone" dataKey="mortgage" stroke={SPEND} fill={SPEND} fillOpacity={0.2} name="Remaining mortgage" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 12, marginBottom: 24 }}>
            <StatLine label="Mortgage payoff" value={houseProjection.payoffAge ? "Your age " + houseProjection.payoffAge : "Not paid off in horizon"} accent={ASSET} />
            <StatLine label={"Home equity at planning horizon"} value={fmt((houseProjection.rows[houseProjection.rows.length - 1] || {}).equity || 0)} />
          </div>

          <SectionTitle accent={ASSET}>Vehicles</SectionTitle>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <LineChart margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="age" type="number" domain={[inp.currentAge, projection.horizon]} tick={{ fontSize: 11, fill: MUTED }} allowDuplicatedCategory={false} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={a => "Your age " + a} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {inp.vehicles.map((v, i) => (
                  <Line key={i} data={vehicleResults[i].rows} dataKey="value" name={v.name} stroke={[ASSET, SPOUSE, CAUTION][i % 3]} dot={false} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: 28 }}>
            <SectionTitle>Total net worth (incl. property &amp; vehicles)</SectionTitle>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <AreaChart data={totalNetWorthRows} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={LINE} vertical={false} />
                  <XAxis dataKey="age" tick={{ fontSize: 11, fill: MUTED }} />
                  <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                  <Tooltip formatter={(v) => fmt(v)} labelFormatter={a => "Your age " + a} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="liquid" stackId="1" stroke={GROWTH} fill={GROWTH} fillOpacity={0.35} name="Investments" />
                  <Area type="monotone" dataKey="equity" stackId="1" stroke={ASSET} fill={ASSET} fillOpacity={0.35} name="Home equity" />
                  <Area type="monotone" dataKey="vehicles" stackId="1" stroke={CAUTION} fill={CAUTION} fillOpacity={0.35} name="Vehicles" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {tab === "rmd" && (
        <div>
          <SectionTitle>Required minimum distributions</SectionTitle>
          <p style={{ fontSize: 13, color: MUTED, marginTop: -6 }}>
            Each spouse's RMD starts at their own age 73, based on their own traditional balance.
          </p>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={rmdSchedule} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="age" tick={{ fontSize: 11, fill: MUTED }} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={a => "Your age " + a} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="yourRmd" stackId="rmd" fill={GROWTH} radius={[0, 0, 0, 0]} name="Your RMD" />
                <Bar dataKey="spouseRmd" stackId="rmd" fill={SPOUSE} radius={[3, 3, 0, 0]} name="Spouse RMD" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 16 }}>
            <StatLine label="First combined RMD year" value={firstRmdRow ? "Your age " + firstRmdRow.age : "N/A"} />
            <StatLine label="First combined RMD amount" value={firstRmdRow ? fmt(firstRmdRow.rmd) : "N/A"} accent={CAUTION} />
          </div>
        </div>
      )}

      {tab === "ss" && (
        <div>
          <SectionTitle>Your claiming age comparison</SectionTitle>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="age" type="number" domain={[62, inp.lifeExpectancy]} tick={{ fontSize: 11, fill: MUTED }} allowDuplicatedCategory={false} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={a => "Age " + a} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {ssComp.you.map((s, i) => (
                  <Line key={s.claimAge} data={s.cumulative} dataKey="total" name={"Claim at " + s.claimAge} stroke={[GROWTH, CAUTION, SPEND][i]} dot={false} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 12, marginBottom: 24 }}>
            {ssComp.you.map(s => (
              <StatLine key={s.claimAge} label={"Claim at " + s.claimAge + " \u2192 annual benefit"} value={fmt(s.annual)} />
            ))}
          </div>

          <SectionTitle accent={SPOUSE}>Spouse's claiming age comparison</SectionTitle>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke={LINE} vertical={false} />
                <XAxis dataKey="age" type="number" domain={[62, inp.spouseLifeExpectancy]} tick={{ fontSize: 11, fill: MUTED }} allowDuplicatedCategory={false} />
                <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                <Tooltip formatter={(v) => fmt(v)} labelFormatter={a => "Age " + a} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {ssComp.spouse.map((s, i) => (
                  <Line key={s.claimAge} data={s.cumulative} dataKey="total" name={"Claim at " + s.claimAge} stroke={[GROWTH, CAUTION, SPOUSE][i]} dot={false} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 12 }}>
            {ssComp.spouse.map(s => (
              <StatLine key={s.claimAge} label={"Claim at " + s.claimAge + " \u2192 annual benefit"} value={fmt(s.annual)} />
            ))}
          </div>
        </div>
      )}

      {tab === "529" && (
        <div>
          {inp.plan529s.map((plan, i) => {
            const result = plan529Results[i];
            const startBalance = (result.rows.find(r => r.age === plan.withdrawStartAge) || {}).balance || 0;
            return (
              <div key={i} style={{ marginBottom: 28 }}>
                <SectionTitle>{plan.name || "529 plan " + (i + 1)}</SectionTitle>
                <p style={{ fontSize: 13, color: MUTED, marginTop: -6 }}>
                  Contributions run until age {plan.withdrawStartAge}, then {fmt(plan.annualWithdrawal)} is withdrawn each year for {plan.withdrawYears} years.
                </p>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <AreaChart data={result.rows} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke={LINE} vertical={false} />
                      <XAxis dataKey="age" tick={{ fontSize: 11, fill: MUTED }} />
                      <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={v => "$" + (v / 1000).toFixed(0) + "k"} width={50} />
                      <Tooltip formatter={(v) => fmt(v)} labelFormatter={a => "Age " + a} />
                      <ReferenceLine x={plan.withdrawStartAge} stroke={SPEND} strokeDasharray="3 3" label={{ value: "Withdraw", fontSize: 11, fill: SPEND }} />
                      <Area type="monotone" dataKey="balance" stroke={SPEND} fill={SPEND} fillOpacity={0.3} name="Balance" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ marginTop: 12 }}>
                  <StatLine label="Balance at withdrawal start" value={fmt(startBalance)} />
                  <StatLine
                    label="Covers full withdrawal schedule"
                    value={result.depletedEarly ? "No — runs short" : "Yes"}
                    accent={result.depletedEarly ? SPEND : GROWTH}
                  />
                </div>
              </div>
            );
          })}
          <p style={{ fontSize: 12, color: MUTED, marginTop: 4, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            Withdrawals used for qualified education expenses are tax-free. Non-qualified withdrawals owe income tax plus a 10% penalty on earnings — this model assumes every withdrawal is qualified.
          </p>
        </div>
      )}

      {tab === "milestones" && (
        <div>
          <SectionTitle>Timeline of key ages</SectionTitle>
          <p style={{ fontSize: 12, color: MUTED, marginTop: -6 }}>Ages shown are yours — spouse milestones are translated to your age for a single timeline.</p>
          <div>
            {milestones.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 14, padding: "10px 0", borderBottom: `1px solid ${LINE}`, alignItems: "center" }}>
                <div style={{
                  minWidth: 40, height: 40, borderRadius: 3, background: m.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 500, color: "#fff", flexShrink: 0
                }}>
                  {m.age}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{m.label}</div>
                  <div style={{ fontSize: 12.5, color: MUTED }}>{m.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "insights" && (
        <div>
          <SectionTitle>Planning insights</SectionTitle>
          <ul style={{ paddingLeft: 18, fontSize: 14, margin: 0 }}>
            <li style={{ marginBottom: 10 }}>
              {projection.depletionAge
                ? "Under these assumptions, the liquid portfolio is projected to deplete at your age " + projection.depletionAge + ", before the planning horizon of " + projection.horizon + "."
                : "Under these assumptions, the liquid portfolio lasts through the planning horizon (your age " + projection.horizon + "), ending with roughly " + fmt(finalRow ? finalRow.netWorth : 0) + " remaining."}
            </li>
            <li style={{ marginBottom: 10 }}>
              You retire at {inp.retirementAge}; your spouse retires at {inp.spouseRetirementAge} (your age {inp.spouseRetirementAge - projection.ageOffset}). Household withdrawals for spending begin once the later of the two has retired.
            </li>
            <li style={{ marginBottom: 10 }}>
              Your first RMD hits at 73; your spouse's hits at their own 73 (your age {73 - projection.ageOffset}). Each is calculated on that person's own traditional balance and withdrawn regardless of spending need.
            </li>
            <li style={{ marginBottom: 10 }}>
              Delaying your Social Security from 62 to 70 raises your annual benefit from {fmt(ssComp.you[0].annual)} to {fmt(ssComp.you[2].annual)}. For your spouse, delaying from 62 to 70 raises theirs from {fmt(ssComp.spouse[0].annual)} to {fmt(ssComp.spouse[2].annual)}.
            </li>
            <li style={{ marginBottom: 10 }}>
              The withdrawal order used here is: both RMDs (forced) &rarr; {inp.withdrawalOrder.map(k => WITHDRAWAL_LABELS[k]).join(" \u2192 ")}. Any RMD beyond what's needed for spending is reinvested into the taxable account. Major purchases draw from the same order at the age specified.
            </li>
            <li style={{ marginBottom: 10 }}>
              {houseProjection.payoffAge
                ? "The mortgage is projected to be paid off at your age " + houseProjection.payoffAge + "."
                : "The mortgage is not projected to be paid off within the planning horizon at the current payment amount."}{" "}
              Home equity reaches roughly {fmt((houseProjection.rows[houseProjection.rows.length - 1] || {}).equity || 0)} by the planning horizon.
            </li>
            {inp.majorPurchases.length > 0 && (
              <li style={{ marginBottom: 10 }}>
                {inp.majorPurchases.map((p, i) => {
                  const row = projection.rows.find(r => r.age === p.age);
                  const underfunded = row && row.purchaseShortfall > 0;
                  return (
                    <div key={i} style={{ marginBottom: i < inp.majorPurchases.length - 1 ? 6 : 0 }}>
                      {p.name || "Major purchase"}: {fmt(p.amount)} withdrawal planned at your age {p.age}.{" "}
                      {underfunded ? "Projected available balances fall short by " + fmt(row.purchaseShortfall) + " that year." : "Projected balances cover this withdrawal."}
                    </div>
                  );
                })}
              </li>
            )}
            <li style={{ marginBottom: 10 }}>
              {inp.plan529s.map((plan, i) => (
                <div key={i} style={{ marginBottom: i < inp.plan529s.length - 1 ? 6 : 0 }}>
                  {(plan.name || "529 plan " + (i + 1))} draws {fmt(plan.annualWithdrawal)} per year for {plan.withdrawYears} years starting at your age {plan.withdrawStartAge}.{" "}
                  {plan529Results[i].depletedEarly
                    ? "At current assumptions, the balance runs short before the schedule finishes."
                    : "At current assumptions, the balance covers the full schedule."}
                </div>
              ))}
            </li>
          </ul>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 18, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            This is an illustrative model with simplified assumptions (constant real returns, no market volatility, no taxes on withdrawals themselves, shared growth-rate assumption across both spouses, house/vehicle values tracked separately from portfolio cash flow). It is not financial or tax advice.
          </p>
        </div>
      )}
    </div>
  );
}
