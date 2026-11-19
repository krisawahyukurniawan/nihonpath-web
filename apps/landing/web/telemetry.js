export const { stations, sampleAscent, plotPoint, ascentClock } = (() => {
  'use strict';

  // Brief-supplied illustration knots, NOT surveyed trail telemetry.
  // The official Yoshida route is 6.8 km to its route summit, not Kengamine.
  const stations = Object.freeze(
    [
      { distance: 0, elevation: 2305, minutes: 0, kanji: 0 },
      { distance: 1.4, elevation: 2390, minutes: 60, kanji: 103 },
      { distance: 3.2, elevation: 2700, minutes: 160, kanji: 300 },
      { distance: 5, elevation: 3100, minutes: 270, kanji: 1026 },
      { distance: 7.5, elevation: 3776, minutes: 390, kanji: 2136 },
    ].map(Object.freeze),
  );

  function sampleAscent(progress) {
    const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    const distance = p * 7.5;
    let index = 0;
    while (index < stations.length - 1 && distance + 1e-9 >= stations[index + 1].distance)
      index += 1;
    const start = stations[index];
    const end = stations[Math.min(index + 1, 4)];
    const ratio =
      end.distance === start.distance
        ? 0
        : (distance - start.distance) / (end.distance - start.distance);
    const elevation = start.elevation + (end.elevation - start.elevation) * ratio;
    const minutes = start.minutes + (end.minutes - start.minutes) * ratio;
    const gain = elevation - 2305;
    return {
      progress: p,
      index,
      distance,
      elevation,
      gain,
      seconds: Math.round(minutes * 60),
      temperature: 15.4 - 0.0065 * gain,
      kanji: start.kanji,
    };
  }

  function plotPoint({ distance, elevation }) {
    return { x: 70 + (distance / 7.5) * 984, y: 298 - ((elevation - 2305) / 1471) * 274 };
  }

  function ascentClock(seconds) {
    const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
    return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  }

  return { stations, sampleAscent, plotPoint, ascentClock };
})();
