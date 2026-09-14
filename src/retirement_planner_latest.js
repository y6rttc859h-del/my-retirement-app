import React, { useState, useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from "recharts";

// Modernized Design System Palette
const COLOR_SYSTEM = {
  ink: "#1E2A2E",
  paper: "#FAF9F4",
  line: "#D8D5C8",
  growth: "#2F6F5E",
  caution: "#B8862F",
  spend: "#A15A44",
  spouse: "#5C6FA8",
  asset: "#7A5C8E",
  tax: "#B23A48",
  hsa: "#3F8F8A",
  muted: "#7A786E"
};

const RMD_TABLE = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
  94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5
};

const STANDARD_DEDUCTION_MFJ = 32200;
const ORDINARY_BRACKETS_MFJ = [
  { upto: 24800, rate: 0.10 }, { upto: 100800, rate: 0.12 }, { upto: 211400, rate: 0.22 },
  { upto: 403550, rate: 0.24 }, { upto: 512450, rate: 0.32 }, { upto: 768700, rate: 0.35 }, { upto: Infinity, rate: 0.37 },
];
const LTCG_BRACKETS_MFJ = [{ upto: 98900, rate: 0 }, { upto: 613700, rate: 0.15 }, { upto: Infinity, rate: 0.20 }];
const NIIT_THRESHOLD_MFJ = 250000;
const SS_THRESHOLD_1 = 32000;
const SS_THRESHOLD_2 = 44000;

function rmdFactor(age) {
  if (age < 73) return null;
  if (age > 110) return 2.9;
  return RMD_TABLE[age] || 3.5;
}

function ssMultiplier(claimAge, fra) {
  if (claimAge === fra) return 1;
  if (claimAge < fra) {
    const monthsEarly = (fra - claimAge) * 12;
    const reduction = monthsEarly <= 36 
      ? monthsEarly * (5 / 9) / 100 
      : 36 * (5 / 9) / 100 + (monthsEarly - 36) * (5 / 12) / 100;
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

function computeFederalTax(ordinaryIncome, capGainsIncome) {
  const taxableOrdinary = Math.max(0, ordinaryIncome - STANDARD_DEDUCTION_MFJ);
  let ordinaryTax = 0, lastCap = 0;
  for (const b of ORDINARY_BRACKETS_MFJ) {
    if (taxableOrdinary > lastCap) { 
      ordinaryTax += (Math.min(taxableOrdinary, b.upto) - lastCap) * b.rate; 
      lastCap = b.upto; 
    } else break;
  }
  let ltcgTax = 0, cursor = taxableOrdinary, remainingGains = capGainsIncome;
  for (const b of LTCG_BRACKETS_MFJ) {
    if (remainingGains <= 0) break;
    const room = Math.max(0, b.upto - cursor);
    const amt = Math.min(remainingGains, room);
    ltcgTax += amt * b.rate; 
    remainingGains -= amt; 
    cursor += amt;
  }
  const magi = ordinaryIncome + capGainsIncome;
  const niit = magi > NIIT_THRESHOLD_MFJ ? Math.min(capGainsIncome, magi - NIIT_THRESHOLD_MFJ) * 0.038 : 0;
  return { tax: ordinaryTax + ltcgTax + niit, ordinaryTax, ltcgTax, niit };
}

function computeTaxableSS(grossSS, otherOrdinaryIncome) {
  if (grossSS <= 0) return 0;
  const provisional = otherOrdinaryIncome + 0.5 * grossSS;
  if (provisional <= SS_THRESHOLD_1) return 0;
  let taxable;
  if (provisional <= SS_THRESHOLD_2) taxable = 0.5 * (provisional - SS_THRESHOLD_1);
  else taxable = 0.5 * (SS_THRESHOLD_2 - SS_THRESHOLD_1) + 0.85 * (provisional - SS_THRESHOLD_2);
  return Math.min(taxable, 0.85 * grossSS);
}

// Custom hook to decouple heavy projection calculations from UI lifecycle
export function useRetirementProjection(inp) {
  return useMemo(() => {
    const ageOffset = inp.spouseCurrentAge - inp.currentAge;
    const householdRetireAge = Math.max(inp.retirementAge, inp.spouseRetirementAge - ageOffset);
    const horizon = Math.max(inp.lifeExpectancy, inp.spouseLifeExpectancy - ageOffset);
    const realPre = (1 + (inp.preReturn - inp.feeDragPercent) / 100) / (1 + inp.inflation / 100) - 1;
    const realPost = (1 + (inp.postReturn - inp.feeDragPercent) / 100) / (1 + inp.inflation / 100) - 1;

    const yourSSAnnual = inp.yourSSBenefitFRA * ssMultiplier(inp.yourSSClaimAge, inp.yourSSFRA);
    const spouseSSAnnual = inp.spouseSSBenefitFRA * ssMultiplier(inp.spouseSSClaimAge, inp.spouseSSFRA);

    let yourTraditional = inp.yourTraditionalBalance;
    let spouseTraditional = inp.spouseTraditionalBalance;
    let taxable = inp.taxableBalance;
    let roth = inp.rothBalance;
    let hsa = inp.hsa.balance;

    const rows = [];
    let depletionAge = null;
    const alerts = [];

    for (let age = inp.currentAge; age <= horizon; age++) {
      const idx = age - inp.currentAge;
      const spouseAge = age + ageOffset;
      const accumulating = age < householdRetireAge;
      const returnRate = accumulating ? realPre : realPost;

      if (accumulating) {
        yourTraditional = yourTraditional * (1 + returnRate) + inp.yourTraditionalMonthly * 12;
        spouseTraditional = spouseTraditional * (1 + returnRate) + inp.spouseTraditionalMonthly * 12;
        taxable = taxable * (1 + returnRate) + inp.taxableMonthly * 12;
        roth = roth * (1 + returnRate) + inp.rothMonthly * 12;
      } else {
        yourTraditional *= (1 + returnRate); 
        spouseTraditional *= (1 + returnRate); 
        taxable *= (1 + returnRate); 
        roth *= (1 + returnRate);
      }

      const yourFactor = rmdFactor(age);
      const spouseFactor = rmdFactor(spouseAge);
      const yourRmd = yourFactor ? yourTraditional / yourFactor : 0;
      const spouseRmd = spouseFactor ? spouseTraditional / spouseFactor : 0;
      const totalRmd = yourRmd + spouseRmd;

      yourTraditional -= yourRmd;
      spouseTraditional -= spouseRmd;

      const grossSS = (!accumulating && age >= inp.yourSSClaimAge ? yourSSAnnual : 0) +
                      (!accumulating && spouseAge >= inp.spouseSSClaimAge ? spouseSSAnnual : 0);

      const totalSpending = accumulating ? 0 : inp.annualSpending;
      const netWithdrawalNeeded = Math.max(0, totalSpending - grossSS - totalRmd);

      // Simple withdrawal order execution
      let drawnFromTaxable = Math.min(taxable, netWithdrawalNeeded);
      taxable -= drawnFromTaxable;
      let remainingNeed = netWithdrawalNeeded - drawnFromTaxable;

      let drawnFromTrad = Math.min(yourTraditional, remainingNeed);
      yourTraditional -= drawnFromTrad;
      remainingNeed -= drawnFromTrad;

      let drawnFromRoth = Math.min(roth, remainingNeed);
      roth -= drawnFromRoth;
      remainingNeed -= drawnFromRoth;

      const ordinaryIncome = totalRmd + drawnFromTrad;
      const taxableSS = computeTaxableSS(grossSS, ordinaryIncome);
      const taxResult = computeFederalTax(ordinaryIncome + taxableSS, 0);

      const netWorth = yourTraditional + spouseTraditional + taxable + roth + hsa;

      if (netWorth <= 0 && depletionAge === null && age >= householdRetireAge) {
        depletionAge = age;
        alerts.push({ type: "danger", message: `Portfolio depletion projected at age ${age}.` });
      }

      rows.push({
        age, spouseAge,
        yourTraditional: Math.round(yourTraditional),
        spouseTraditional: Math.round(spouseTraditional),
        taxable: Math.round(taxable),
        roth: Math.round(roth),
        netWorth: Math.round(netWorth),
        ssIncome: Math.round(grossSS),
        taxPaid: Math.round(taxResult.tax),
        spendingThisYear: Math.round(totalSpending)
      });
    }

    return { rows, depletionAge, alerts, householdRetireAge };
  }, [inp]);
}

export default function RetirementPlannerDashboard({ inputs }) {
  const { rows, depletionAge, alerts } = useRetirementProjection(inputs);

  return (
    <div style={{ backgroundColor: COLOR_SYSTEM.paper, color: COLOR_SYSTEM.ink, padding: "24px", fontFamily: "sans-serif" }}>
      {/* Executive Experience Banner */}
      <header style={{ borderBottom: `2px solid ${COLOR_SYSTEM.line}`, paddingBottom: "16px", marginBottom: "24px" }}>
        <h1 style={{ margin: 0, fontSize: "28px" }}>Retirement Intelligence Dashboard</h1>
        <p style={{ margin: "4px 0 0 0", color: COLOR_SYSTEM.muted }}>
          Executive Scenario & Portfolio Sustainability Model
        </p>
      </header>

      {/* Dynamic Context Alerts */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          {alerts.map((alert, idx) => (
            <div key={idx} style={{
              backgroundColor: alert.type === "danger" ? "#FADBD8" : "#FCF3CF",
              borderLeft: `6px solid ${alert.type === "danger" ? COLOR_SYSTEM.tax : COLOR_SYSTEM.caution}`,
              padding: "12px 16px",
              borderRadius: "4px",
              fontWeight: "bold",
              marginBottom: "8px"
            }}>
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Primary KPI Visuals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "32px" }}>
        <div style={{ background: "#FFF", padding: "16px", borderRadius: "8px", border: `1px solid ${COLOR_SYSTEM.line}` }}>
          <span style={{ fontSize: "12px", color: COLOR_SYSTEM.muted, textTransform: "uppercase" }}>Depletion Target</span>
          <div style={{ fontSize: "24px", fontWeight: "bold", marginTop: "4px", color: depletionAge ? COLOR_SYSTEM.tax : COLOR_SYSTEM.growth }}>
            {depletionAge ? `Age ${depletionAge}` : "Never"}
          </div>
        </div>
        <div style={{ background: "#FFF", padding: "16px", borderRadius: "8px", border: `1px solid ${COLOR_SYSTEM.line}` }}>
          <span style={{ fontSize: "12px", color: COLOR_SYSTEM.muted, textTransform: "uppercase" }}>Ending Net Worth</span>
          <div style={{ fontSize: "24px", fontWeight: "bold", marginTop: "4px", color: COLOR_SYSTEM.ink }}>
            {fmt(rows[rows.length - 1]?.netWorth)}
          </div>
        </div>
      </div>

      {/* Chart Section */}
      <div style={{ background: "#FFF", padding: "20px", borderRadius: "8px", border: `1px solid ${COLOR_SYSTEM.line}`, marginBottom: "32px" }}>
        <h3 style={{ marginTop: 0, marginBottom: "16px" }}>Asset Trajectory Projection</h3>
        <ResponsiveContainer width="100%" height={350}>
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLOR_SYSTEM.line} />
            <XAxis dataKey="age" />
            <YAxis tickFormatter={(v) => `$${v / 1000}k`} />
            <Tooltip formatter={(value) => fmt(value)} />
            <Legend />
            <Area type="monotone" dataKey="taxable" stackId="1" name="Taxable Brokerage" stroke={COLOR_SYSTEM.growth} fill={COLOR_SYSTEM.growth} />
            <Area type="monotone" dataKey="yourTraditional" stackId="1" name="Your Pre-Tax" stroke={COLOR_SYSTEM.spouse} fill={COLOR_SYSTEM.spouse} />
            <Area type="monotone" dataKey="roth" stackId="1" name="Roth Accounts" stroke={COLOR_SYSTEM.asset} fill={COLOR_SYSTEM.asset} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
