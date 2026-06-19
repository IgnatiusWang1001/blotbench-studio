import type { LaneResult } from './analysis'
import type {
  StatisticalSettings,
  StatisticsComparisonMode,
  StatisticsCorrectionMode,
  StatisticsMethod,
} from '../types'

export interface StatisticalComparison {
  groupA: string
  groupB: string
  valuesA: number[]
  valuesB: number[]
  meanDifference: number
  pValue: number
  adjustedPValue: number
  alpha: number
  stars: string
  significant: boolean
}

export interface StatisticalSummary {
  enabled: boolean
  method: StatisticsMethod
  comparisonMode: StatisticsComparisonMode
  correction: StatisticsCorrectionMode
  baselineGroup: string | null
  alpha: number
  comparisons: StatisticalComparison[]
  warnings: string[]
  omnibusPValue?: number | null
}

export const defaultStatisticalSettings: StatisticalSettings = {
  enabled: true,
  method: 'welch-t',
  comparisonMode: 'vs-baseline',
  baselineGroup: 'Control',
  correction: 'holm',
  alpha: 0.05,
  showNonSignificant: false,
}

export function buildStatisticalSummary(
  lanes: LaneResult[],
  settings: StatisticalSettings,
): StatisticalSummary {
  const groups = collectGroups(lanes.filter((lane) => lane.enabled))
  const warnings: string[] = []

  if (!settings.enabled) {
    return {
      enabled: false,
      method: settings.method,
      comparisonMode: settings.comparisonMode,
      correction: settings.correction,
      baselineGroup: settings.baselineGroup || null,
      alpha: settings.alpha,
      comparisons: [],
      warnings,
      omnibusPValue: null,
    }
  }

  if (groups.length < 2) {
    warnings.push('At least two active groups are required before statistical comparison can be shown.')
    return {
      enabled: true,
      method: settings.method,
      comparisonMode: settings.comparisonMode,
      correction: settings.correction,
      baselineGroup: settings.baselineGroup || null,
      alpha: settings.alpha,
      comparisons: [],
      warnings,
      omnibusPValue: null,
    }
  }

  const omnibusPValue =
    settings.comparisonMode === 'anova-posthoc' && groups.length >= 3
      ? oneWayAnovaPValue(groups.map((group) => group.values))
      : null
  const comparisons = buildPairwiseComparisons(groups, settings)
  if (!comparisons.length) {
    warnings.push('No valid group comparisons could be generated from the current sample sheet.')
    return {
      enabled: true,
      method: settings.method,
      comparisonMode: settings.comparisonMode,
      correction: settings.correction,
      baselineGroup: settings.baselineGroup || null,
      alpha: settings.alpha,
      comparisons: [],
      warnings,
      omnibusPValue,
    }
  }

  if (settings.comparisonMode === 'anova-posthoc' && groups.length < 3) {
    warnings.push('ANOVA mode requires at least three active groups.')
  }

  const validComparisons = comparisons.filter(
    (comparison) => comparison.valuesA.length >= 2 && comparison.valuesB.length >= 2,
  )

  if (validComparisons.length !== comparisons.length) {
    warnings.push('Groups with fewer than two active replicates were skipped for significance testing.')
  }

  const pValues = validComparisons.map((comparison) =>
    testPValue(comparison.valuesA, comparison.valuesB, settings.method),
  )
  const adjustedPValues = adjustPValues(pValues, settings.correction)
  const decorated = validComparisons.map((comparison, index) => {
    const adjusted = adjustedPValues[index]
    const stars = starLabel(adjusted, settings.alpha, settings.showNonSignificant)
    return {
      ...comparison,
      pValue: pValues[index],
      adjustedPValue: adjusted,
      alpha: settings.alpha,
      stars,
      significant: adjusted <= settings.alpha,
    }
  })

  if (!decorated.length) {
    warnings.push('No statistical comparison passed the minimum replicate requirement.')
  }

  return {
    enabled: true,
    method: settings.method,
    comparisonMode: settings.comparisonMode,
    correction: settings.correction,
    baselineGroup: resolveBaselineGroup(groups, settings.baselineGroup),
    alpha: settings.alpha,
    comparisons: decorated,
    warnings,
    omnibusPValue,
  }
}

function testPValue(valuesA: number[], valuesB: number[], method: StatisticsMethod) {
  if (method === 'welch-t') {
    return welchTPValue(valuesA, valuesB)
  }
  return permutationPValue(valuesA, valuesB)
}

function collectGroups(lanes: LaneResult[]) {
  const map = new Map<string, number[]>()

  lanes.forEach((lane) => {
    const values = map.get(lane.group) ?? []
    values.push(lane.displayValue)
    map.set(lane.group, values)
  })

  return Array.from(map.entries()).map(([group, values]) => ({ group, values }))
}

function buildPairwiseComparisons(
  groups: Array<{ group: string; values: number[] }>,
  settings: StatisticalSettings,
) {
  if (settings.comparisonMode === 'all-pairs') {
    const comparisons: Array<{
      groupA: string
      groupB: string
      valuesA: number[]
      valuesB: number[]
      meanDifference: number
    }> = []

    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        comparisons.push(makeComparison(groups[left], groups[right]))
      }
    }

    return comparisons
  }

  if (settings.comparisonMode === 'anova-posthoc') {
    const comparisons: Array<{
      groupA: string
      groupB: string
      valuesA: number[]
      valuesB: number[]
      meanDifference: number
    }> = []

    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        comparisons.push(makeComparison(groups[left], groups[right]))
      }
    }

    return comparisons
  }

  const baseline = resolveBaselineGroup(groups, settings.baselineGroup)
  if (!baseline) {
    return []
  }

  const baseGroup = groups.find((group) => group.group === baseline)
  if (!baseGroup) {
    return []
  }

  return groups
    .filter((group) => group.group !== baseline)
    .map((group) => makeComparison(baseGroup, group))
}

function makeComparison(
  groupA: { group: string; values: number[] },
  groupB: { group: string; values: number[] },
) {
  return {
    groupA: groupA.group,
    groupB: groupB.group,
    valuesA: groupA.values,
    valuesB: groupB.values,
    meanDifference: mean(groupB.values) - mean(groupA.values),
  }
}

function resolveBaselineGroup(
  groups: Array<{ group: string; values: number[] }>,
  preferred: string,
) {
  if (groups.some((group) => group.group === preferred)) {
    return preferred
  }
  return groups[0]?.group ?? null
}

function permutationPValue(valuesA: number[], valuesB: number[]) {
  const combined = [...valuesA, ...valuesB]
  const sizeA = valuesA.length
  const observed = Math.abs(mean(valuesA) - mean(valuesB))
  const exactCombinations = choose(combined.length, sizeA)

  if (exactCombinations <= 50000) {
    let total = 0
    let extreme = 0
    enumerateCombinations(combined.length, sizeA, (indexes) => {
      const mask = new Set(indexes)
      const sampleA: number[] = []
      const sampleB: number[] = []
      combined.forEach((value, index) => {
        if (mask.has(index)) {
          sampleA.push(value)
        } else {
          sampleB.push(value)
        }
      })
      const diff = Math.abs(mean(sampleA) - mean(sampleB))
      total += 1
      if (diff >= observed - 1e-12) {
        extreme += 1
      }
    })
    return (extreme + 1) / (total + 1)
  }

  const samples = 20000
  const rng = createSeededRandom(seedFromValues(combined))
  let extreme = 0
  for (let sample = 0; sample < samples; sample += 1) {
    const shuffled = [...combined]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }
    const sampleA = shuffled.slice(0, sizeA)
    const sampleB = shuffled.slice(sizeA)
    const diff = Math.abs(mean(sampleA) - mean(sampleB))
    if (diff >= observed - 1e-12) {
      extreme += 1
    }
  }

  return (extreme + 1) / (samples + 1)
}

function welchTPValue(valuesA: number[], valuesB: number[]) {
  const meanA = mean(valuesA)
  const meanB = mean(valuesB)
  const varianceA = sampleVariance(valuesA, meanA)
  const varianceB = sampleVariance(valuesB, meanB)
  const denominator = Math.sqrt(varianceA / valuesA.length + varianceB / valuesB.length)

  if (!Number.isFinite(denominator) || denominator === 0) {
    return 1
  }

  const t = Math.abs(meanA - meanB) / denominator
  const numerator = (varianceA / valuesA.length + varianceB / valuesB.length) ** 2
  const denominatorDf =
    (varianceA ** 2) / (valuesA.length ** 2 * Math.max(valuesA.length - 1, 1)) +
    (varianceB ** 2) / (valuesB.length ** 2 * Math.max(valuesB.length - 1, 1))
  const degreesOfFreedom = denominatorDf > 0 ? numerator / denominatorDf : 1

  return 2 * (1 - studentTCdf(t, degreesOfFreedom))
}

function oneWayAnovaPValue(groupValues: number[][]) {
  const validGroups = groupValues.filter((group) => group.length >= 2)
  const totalCount = validGroups.reduce((sum, group) => sum + group.length, 0)
  if (validGroups.length < 3 || totalCount <= validGroups.length) {
    return null
  }

  const groupMeans = validGroups.map((group) => mean(group))
  const grandMean = mean(validGroups.flat())
  const ssBetween = validGroups.reduce(
    (sum, group, index) => sum + group.length * (groupMeans[index] - grandMean) ** 2,
    0,
  )
  const ssWithin = validGroups.reduce(
    (sum, group, index) =>
      sum + group.reduce((groupSum, value) => groupSum + (value - groupMeans[index]) ** 2, 0),
    0,
  )

  const dfBetween = validGroups.length - 1
  const dfWithin = totalCount - validGroups.length
  if (dfBetween <= 0 || dfWithin <= 0 || ssWithin <= 0) {
    return null
  }

  const msBetween = ssBetween / dfBetween
  const msWithin = ssWithin / dfWithin
  const fValue = msBetween / msWithin
  return 1 - fisherSnedecorCdf(fValue, dfBetween, dfWithin)
}

function adjustPValues(pValues: number[], correction: StatisticsCorrectionMode) {
  if (correction === 'none') {
    return pValues
  }

  const ranked = pValues
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value)
  const adjusted = new Array<number>(pValues.length).fill(1)
  let runningMax = 0

  ranked.forEach((entry, rankIndex) => {
    const scaled = Math.min(1, entry.value * (pValues.length - rankIndex))
    runningMax = Math.max(runningMax, scaled)
    adjusted[entry.index] = runningMax
  })

  return adjusted
}

function starLabel(pValue: number, alpha: number, showNonSignificant: boolean) {
  if (pValue <= 0.001) {
    return '***'
  }
  if (pValue <= 0.01) {
    return '**'
  }
  if (pValue <= alpha) {
    return '*'
  }
  return showNonSignificant ? 'ns' : ''
}

function enumerateCombinations(
  length: number,
  chooseCount: number,
  callback: (indexes: number[]) => void,
) {
  const stack: number[] = []

  function walk(start: number, remaining: number) {
    if (remaining === 0) {
      callback([...stack])
      return
    }

    for (let index = start; index <= length - remaining; index += 1) {
      stack.push(index)
      walk(index + 1, remaining - 1)
      stack.pop()
    }
  }

  walk(0, chooseCount)
}

function choose(n: number, k: number) {
  if (k < 0 || k > n) {
    return 0
  }
  const effectiveK = Math.min(k, n - k)
  let result = 1
  for (let index = 1; index <= effectiveK; index += 1) {
    result = (result * (n - effectiveK + index)) / index
  }
  return result
}

function seedFromValues(values: number[]) {
  return values.reduce(
    (seed, value, index) => (seed + Math.round(value * 1000) * (index + 1)) >>> 0,
    2166136261,
  )
}

function createSeededRandom(seed: number) {
  let current = seed >>> 0
  return () => {
    current = (current * 1664525 + 1013904223) >>> 0
    return current / 4294967296
  }
}

function mean(values: number[]) {
  if (!values.length) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleVariance(values: number[], average: number) {
  if (values.length < 2) {
    return 0
  }
  const total = values.reduce((sum, value) => sum + (value - average) ** 2, 0)
  return total / (values.length - 1)
}

function studentTCdf(t: number, degreesOfFreedom: number) {
  const x = degreesOfFreedom / (degreesOfFreedom + t * t)
  const regularized = regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5)
  return 1 - 0.5 * regularized
}

function fisherSnedecorCdf(value: number, df1: number, df2: number) {
  if (value <= 0) {
    return 0
  }
  const x = (df1 * value) / (df1 * value + df2)
  return regularizedIncompleteBeta(x, df1 / 2, df2 / 2)
}

function regularizedIncompleteBeta(x: number, a: number, b: number) {
  if (x <= 0) {
    return 0
  }
  if (x >= 1) {
    return 1
  }

  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  )

  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a
  }

  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

function betaContinuedFraction(x: number, a: number, b: number) {
  const maxIterations = 200
  const epsilon = 3e-7
  const minValue = 1e-30
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < minValue) {
    d = minValue
  }
  d = 1 / d
  let h = d

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const evenIndex = iteration * 2
    let aa = (iteration * (b - iteration) * x) / ((a + evenIndex - 1) * (a + evenIndex))
    d = 1 + aa * d
    if (Math.abs(d) < minValue) {
      d = minValue
    }
    c = 1 + aa / c
    if (Math.abs(c) < minValue) {
      c = minValue
    }
    d = 1 / d
    h *= d * c

    aa = (-(a + iteration) * (a + b + iteration) * x) / ((a + evenIndex) * (a + evenIndex + 1))
    d = 1 + aa * d
    if (Math.abs(d) < minValue) {
      d = minValue
    }
    c = 1 + aa / c
    if (Math.abs(c) < minValue) {
      c = minValue
    }
    d = 1 / d
    const delta = d * c
    h *= delta

    if (Math.abs(delta - 1) < epsilon) {
      break
    }
  }

  return h
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ]

  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  }

  let x = 0.9999999999998099
  const y = value - 1
  coefficients.forEach((coefficient, index) => {
    x += coefficient / (y + index + 1)
  })
  const t = y + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(x)
}
