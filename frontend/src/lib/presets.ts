// Standard structure presets: bond stack + canonical step list, prefilled.
// Serialized directly in the engine's cashflows.waterfall/1 encoding.

import type { BondLikeSpec, StepSpec, TriggerSpec, WaterfallSpec } from './types';

export interface StructurePreset {
  key: string;
  label: string;
  doc: string;
  build: () => Pick<WaterfallSpec, 'bonds' | 'steps' | 'triggers'> & { reserve_initial?: number };
}

function bond(name: string, size_pct: number, coupon: number, extra: Partial<BondLikeSpec> = {}): BondLikeSpec {
  return {
    type: 'bond', name, size_pct, balance: null, coupon, margin: null,
    floating: false, pik: false, rate_cap: null, rate_floor: null, ...extra,
  } as BondLikeSpec;
}

const residual = (): BondLikeSpec => ({ type: 'residual', name: 'R', balance: null });

function interestSteps(names: string[], seniorReserveDraw = true): StepSpec[] {
  return names.map((n, i) => ({
    name: `${n}_interest`, type: 'pay_interest', bonds: [n],
    reserve_draw: seniorReserveDraw && i === 0, sources: null,
  }));
}

const servicing = (): StepSpec => ({
  name: 'servicing', type: 'fee', annual_rate: 0.01, basis: 'pool', cap: null, fixed_annual: null,
});
const reserve = (): StepSpec => ({ name: 'reserve', type: 'reserve_deposit', target_pct: 0.01, target: null });
const principal = (): StepSpec => ({
  name: 'principal', type: 'pay_principal', bonds: [], rule: 'sequential', amount: 'collections', sources: null,
});
const residualStep = (): StepSpec => ({ name: 'residual', type: 'pay_residual' });

const cnlTrigger = (): TriggerSpec => ({
  name: 'cnl_trigger', metric: 'cnl', threshold: 0.06, breach_when: 'above', window: 1, cure: 'never',
});

function sequentialDeal(sizes: [string, number, number][]): StructurePreset['build'] {
  return () => {
    const names = sizes.map(([n]) => n);
    return {
      bonds: [...sizes.map(([n, s, c]) => bond(n, s, c)), residual()],
      triggers: [cnlTrigger()],
      steps: [
        servicing(),
        ...interestSteps(names),
        reserve(),
        {
          name: 'principal', type: 'if', trigger: 'cnl_trigger',
          then: [{ type: 'turbo', bonds: [], fraction: 1.0, tail_to_residual: true }],
          otherwise: [{ type: 'pay_principal', bonds: [], rule: 'sequential', amount: 'collections', sources: null }],
        },
        residualStep(),
      ],
      reserve_initial: 0,
    };
  };
}

export const PRESETS: StructurePreset[] = [
  {
    key: 'abr',
    label: 'A / B / R',
    doc: 'Two notes + residual, sequential pay, CNL turbo trigger.',
    build: sequentialDeal([['A', 0.85, 0.055], ['B', 0.10, 0.075]]),
  },
  {
    key: 'abcr',
    label: 'A / B / C / R',
    doc: 'Three notes + residual, sequential pay, CNL turbo trigger.',
    build: sequentialDeal([['A', 0.80, 0.055], ['B', 0.10, 0.07], ['C', 0.05, 0.09]]),
  },
  {
    key: 'abcder',
    label: 'A / B / C / D / E / R',
    doc: 'Five notes + residual, sequential pay, CNL turbo trigger.',
    build: sequentialDeal([
      ['A', 0.70, 0.05], ['B', 0.10, 0.06], ['C', 0.08, 0.07],
      ['D', 0.05, 0.085], ['E', 0.04, 0.10],
    ]),
  },
  {
    key: 'clo',
    label: 'CLO (OC/IC tests)',
    doc: 'Senior/sub fees, per-class coverage diversion, incentive fee.',
    build: () => ({
      bonds: [
        bond('A', 0.62, 0.052), bond('B', 0.12, 0.062), bond('C', 0.08, 0.075),
        bond('D', 0.06, 0.09, { pik: true } as Partial<BondLikeSpec>), residual(),
      ],
      triggers: [],
      steps: [
        { name: 'senior_fee', type: 'fee', annual_rate: 0.004, basis: 'pool', cap: null, fixed_annual: null },
        ...interestSteps(['A', 'B']),
        { name: 'coverage_AB', type: 'coverage_diversion', through: 'B', oc_trigger: 1.2, ic_trigger: 1.1 },
        ...interestSteps(['C', 'D'], false),
        { name: 'sub_fee', type: 'fee', annual_rate: 0.003, basis: 'pool', cap: null, fixed_annual: null },
        principal(),
        { name: 'incentive', type: 'incentive_fee', hurdle: 0.12, share: 0.2 },
        residualStep(),
      ],
      reserve_initial: 0,
    }),
  },
  {
    key: 'facility',
    label: 'Facility (senior/mezz)',
    doc: 'Floating senior + mezz warehouse-style facility with full sweep.',
    build: () => ({
      bonds: [
        { ...bond('Senior', 0.8, 0), coupon: null, margin: 0.0175, floating: true } as BondLikeSpec,
        { ...bond('Mezz', 0.1, 0), coupon: null, margin: 0.055, floating: true } as BondLikeSpec,
        residual(),
      ],
      triggers: [],
      steps: [
        servicing(),
        ...interestSteps(['Senior', 'Mezz']),
        principal(),
        residualStep(),
      ],
      reserve_initial: 0,
    }),
  },
];
