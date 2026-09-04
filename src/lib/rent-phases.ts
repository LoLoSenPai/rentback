export type RentPhase = {
  id: string;
  label: string;
  lamportsPerByte: number;
  reductionPercent: number;
  isLiveHint: boolean;
};

export const RENT_PHASES: RentPhase[] = [
  {
    id: "phase-1-live",
    label: "Phase 1",
    lamportsPerByte: 6333,
    reductionPercent: 9,
    isLiveHint: true,
  },
  {
    id: "phase-2",
    label: "Phase 2",
    lamportsPerByte: 5080,
    reductionPercent: 27,
    isLiveHint: false,
  },
  {
    id: "phase-3",
    label: "Phase 3",
    lamportsPerByte: 2575,
    reductionPercent: 63,
    isLiveHint: false,
  },
  {
    id: "phase-4",
    label: "Phase 4",
    lamportsPerByte: 1322,
    reductionPercent: 81,
    isLiveHint: false,
  },
  {
    id: "phase-5",
    label: "Phase 5",
    lamportsPerByte: 696,
    reductionPercent: 90,
    isLiveHint: false,
  },
];

export const RENT_HISTORY_ORIGINAL_LAMPORTS_PER_BYTE = 6960;

export const RENT_PHASE_2_LAMPORTS_PER_BYTE = RENT_PHASES[1].lamportsPerByte;
export const RENT_PHASE_FINAL_LAMPORTS_PER_BYTE = RENT_PHASES[4].lamportsPerByte;
