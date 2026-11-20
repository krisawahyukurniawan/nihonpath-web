import { stations, sampleAscent, plotPoint, ascentClock } from './telemetry.js';
import { kanjiData } from './kanji-data.js';
import { initKanjiStudio } from './kanji-practice.js';
import { initPhysics } from './kanji-physics.js';

(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STUDIO_ENTITY = 'NihonPath Studio Jakarta';
  const STUDIO_ADDRESS =
    'Jl. Jend. Sudirman Kav. 52-53, Senayan, Kebayoran Baru, Jakarta Selatan 12190, Indonesia';
  const STUDIO_EMAIL = 'hello@nihonpath.com';

  const doc = document;
  const rootEl = doc.documentElement;
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktopBreakpointQuery = window.matchMedia('(min-width: 801px)');

  let currentLang = rootEl.lang === 'id' ? 'id' : 'en';
  const t = (en, id) => (currentLang === 'id' ? id : en);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isReducedMotion = () => reducedMotionQuery.matches;

  function formatInt(value) {
    return new Intl.NumberFormat(currentLang === 'id' ? 'id-ID' : 'en-US').format(
      Math.round(value),
    );
  }

  function formatDecimal(value, digits = 1) {
    return new Intl.NumberFormat(currentLang === 'id' ? 'id-ID' : 'en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  /* ------------------------------------------------------------------ */
  /* Inline brand & studio rendering                                    */
  /* ------------------------------------------------------------------ */

  function createBrandInline() {
    const outer = doc.createElement('span');
    outer.className = 'brand-inline';
    outer.setAttribute('aria-label', 'NihonPath');
    outer.setAttribute('translate', 'no');

    const kanji = doc.createElement('span');
    kanji.setAttribute('aria-hidden', 'true');
    kanji.className = 'brand-kanji';
    kanji.textContent = '日';

    const name = doc.createElement('span');
    name.setAttribute('aria-hidden', 'true');
    name.textContent = 'NihonPath';

    const dot = doc.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.className = 'brand-dot';
    dot.textContent = '.';

    outer.append(kanji, name, dot);
    return outer;
  }

  function createStudioInline() {
    const wrapper = doc.createElement('span');
    wrapper.className = 'studio-name';
    wrapper.append(createBrandInline(), doc.createTextNode(' Studio Jakarta'));
    return wrapper;
  }

  function decorateBrandText(scope = doc.body) {
    if (!scope) return;
    const brandPattern = /(NihonPath Studio Jakarta|NihonPath)/g;
    const skippedTags = new Set([
      'SCRIPT',
      'STYLE',
      'TITLE',
      'DESC',
      'TEXTAREA',
      'INPUT',
      'OPTION',
      'SELECT',
      'CODE',
      'SVG',
    ]);
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.includes('NihonPath')) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || skippedTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('svg, .brand, .brand-inline, .studio-name')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const targets = [];
    let current;
    while ((current = walker.nextNode())) targets.push(current);

    for (const node of targets) {
      const text = node.nodeValue;
      brandPattern.lastIndex = 0;
      let match;
      let lastIndex = 0;
      const fragment = doc.createDocumentFragment();
      while ((match = brandPattern.exec(text))) {
        if (match.index > lastIndex) {
          fragment.append(doc.createTextNode(text.slice(lastIndex, match.index)));
        }
        fragment.append(match[0] === STUDIO_ENTITY ? createStudioInline() : createBrandInline());
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < text.length) {
        fragment.append(doc.createTextNode(text.slice(lastIndex)));
      }
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Toast feedback                                                     */
  /* ------------------------------------------------------------------ */

  const toastEl = doc.querySelector('#toast');
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) return;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
      toastEl.textContent = '';
      toastTimer = null;
    }, 3200);
  }

  /* ------------------------------------------------------------------ */
  /* Block 01 · Smart header, active nav pill, mobile dialog sheet      */
  /* ------------------------------------------------------------------ */

  const header = doc.querySelector('.site-header');
  const desktopNav = doc.querySelector('.desktop-nav');
  const navLinks = desktopNav ? [...desktopNav.querySelectorAll('a[href^="#"]')] : [];
  const navIndicator = doc.querySelector('.nav-indicator');
  const menuToggle = doc.querySelector('.menu-toggle');
  const mobileMenu = doc.querySelector('#mobile-menu');
  const menuClose = doc.querySelector('#menu-close');
  const trackedSections = navLinks
    .map((link) => doc.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  let lastScrollY = window.scrollY;
  let activeNavIndex = -1;

  function updateNavIndicator(navMetrics) {
    if (!desktopNav || !navIndicator) return;
    const activeLink = navLinks[activeNavIndex];
    if (navMetrics === null || !activeLink) {
      navIndicator.style.opacity = '0';
      return;
    }
    let navRect;
    let linkRect;
    if (navMetrics) {
      navRect = navMetrics.navRect;
      linkRect = navMetrics.navLinkRects[activeNavIndex];
    } else {
      if (desktopNav.offsetParent === null) {
        navIndicator.style.opacity = '0';
        return;
      }
      navRect = desktopNav.getBoundingClientRect();
      linkRect = activeLink.getBoundingClientRect();
    }
    if (!navRect || !linkRect) {
      navIndicator.style.opacity = '0';
      return;
    }
    navIndicator.style.width = `${linkRect.width}px`;
    navIndicator.style.transform = `translateX(${linkRect.left - navRect.left}px)`;
    navIndicator.style.opacity = '1';
  }

  function updateActiveNav(sectionRects, scrollY, innerHeight, navMetrics) {
    if (!trackedSections.length) return;
    const rects = sectionRects ?? trackedSections.map((section) => section.getBoundingClientRect());
    const y = scrollY ?? window.scrollY;
    const probe = (innerHeight ?? window.innerHeight) * 0.34;
    let nextIndex = -1;
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      if (rect.top <= probe && rect.bottom > probe * 0.35) {
        nextIndex = i;
      }
    }
    if (nextIndex === -1 && y > 120) {
      for (let i = rects.length - 1; i >= 0; i -= 1) {
        if (rects[i].top <= probe) {
          nextIndex = i;
          break;
        }
      }
    }
    if (nextIndex !== activeNavIndex) {
      activeNavIndex = nextIndex;
      navLinks.forEach((link, idx) => {
        if (idx === activeNavIndex) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }
    updateNavIndicator(navMetrics);
  }

  function updateHeaderVisibility(scrollY) {
    if (!header) return;
    const y = scrollY ?? window.scrollY;
    header.classList.toggle('is-scrolled', y > 24);
    const delta = y - lastScrollY;
    if (mobileMenu?.open || y <= 96) {
      header.classList.remove('is-hidden');
    } else if (delta > 6) {
      header.classList.add('is-hidden');
    } else if (delta < -6) {
      header.classList.remove('is-hidden');
    }
    lastScrollY = y;
  }

  function syncMenuToggleState() {
    if (!menuToggle || !mobileMenu) return;
    const isOpen = Boolean(mobileMenu.open);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute(
      'aria-label',
      isOpen ? t('Close navigation', 'Tutup navigasi') : t('Open navigation', 'Buka navigasi'),
    );
  }

  function closeMobileMenu(restoreFocus = false) {
    if (!mobileMenu?.open) return;
    mobileMenu.close();
    syncMenuToggleState();
    if (restoreFocus) menuToggle?.focus({ preventScroll: true });
  }

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      if (mobileMenu.open) {
        closeMobileMenu(true);
      } else {
        mobileMenu.showModal();
        syncMenuToggleState();
        header?.classList.remove('is-hidden');
      }
    });
    menuClose?.addEventListener('click', () => closeMobileMenu(true));
    mobileMenu.addEventListener('click', (event) => {
      if (event.target === mobileMenu || event.target.closest('nav a')) {
        closeMobileMenu(event.target === mobileMenu);
      }
    });
    mobileMenu.addEventListener('close', () => {
      syncMenuToggleState();
    });
    desktopBreakpointQuery.addEventListener('change', (event) => {
      if (event.matches) closeMobileMenu(false);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Block 02 · Hero panorama parallax                                  */
  /* ------------------------------------------------------------------ */

  const heroSection = doc.querySelector('.hero');
  const panoramaFar = doc.querySelector('.panorama-far');
  const panoramaMid = doc.querySelector('.panorama-mid');
  let heroPointerX = 0;
  let heroPointerY = 0;

  function updateHeroParallax(scrollY, heroHeight) {
    if (!heroSection || !panoramaFar || !panoramaMid) return;
    if (isReducedMotion()) {
      panoramaFar.style.transform = '';
      panoramaMid.style.transform = '';
      return;
    }
    const y = scrollY ?? window.scrollY;
    const height = heroHeight ?? heroSection.offsetHeight;
    const scrollProgress = clamp(y / Math.max(1, height), 0, 1);
    const farX = heroPointerX * -8;
    const farY = heroPointerY * -5 + scrollProgress * 22;
    const midX = heroPointerX * -16;
    const midY = heroPointerY * -10 + scrollProgress * 40;
    panoramaFar.style.transform = `translate3d(${farX.toFixed(2)}px, ${farY.toFixed(2)}px, 0)`;
    panoramaMid.style.transform = `translate3d(${midX.toFixed(2)}px, ${midY.toFixed(2)}px, 0)`;
  }

  if (heroSection) {
    heroSection.addEventListener(
      'pointermove',
      (event) => {
        if (isReducedMotion() || event.pointerType === 'touch') return;
        const rect = heroSection.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        heroPointerX = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
        heroPointerY = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
        updateHeroParallax();
      },
      { passive: true },
    );
    heroSection.addEventListener('pointerleave', () => {
      heroPointerX = 0;
      heroPointerY = 0;
      updateHeroParallax();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Block 03 · Scroll-led story reveal                                 */
  /* ------------------------------------------------------------------ */

  const storySection = doc.querySelector('#story');
  const storyArt = doc.querySelector('.story-art');
  const storyTitle = doc.querySelector('#story-title');
  let storyWords = [];

  function buildStoryWords() {
    if (!storyTitle) return;
    const text = storyTitle.textContent.trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const fragment = doc.createDocumentFragment();
    storyWords = parts.map((word, index) => {
      const span = doc.createElement('span');
      span.className = 'story-word';
      span.textContent = word;
      fragment.append(span);
      if (index < parts.length - 1) fragment.append(doc.createTextNode(' '));
      return span;
    });
    storyTitle.replaceChildren(fragment);
    updateStory();
  }

  function updateStory(storyRect, innerHeight) {
    if (!storySection || !storyWords.length) return;
    if (isReducedMotion()) {
      storyArt?.style.setProperty('--story-light', '0.3');
      storyWords.forEach((word) => word.classList.add('is-lit'));
      return;
    }
    const rect = storyRect ?? storySection.getBoundingClientRect();
    const vh = innerHeight ?? window.innerHeight;
    const scrollable = Math.max(1, rect.height - vh);
    const progress = clamp(-rect.top / scrollable, 0, 1);
    const light = 0.08 + progress * 0.48;
    storyArt?.style.setProperty('--story-light', light.toFixed(3));
    const threshold = progress * 1.08;
    storyWords.forEach((word, index) => {
      const ratio = index / storyWords.length;
      word.classList.toggle('is-lit', ratio <= threshold);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Block 04 · Interactive sample flashcard                            */
  /* ------------------------------------------------------------------ */

  const flashcard = doc.querySelector('#flashcard');
  const flashFront = flashcard?.querySelector('.flashcard-front');
  const flashBack = flashcard?.querySelector('.flashcard-back');

  function syncFlashcardAccessibility() {
    if (!flashcard) return;
    const flipped = flashcard.getAttribute('aria-pressed') === 'true';
    flashFront?.setAttribute('aria-hidden', String(flipped));
    flashBack?.setAttribute('aria-hidden', String(!flipped));
    flashcard.setAttribute(
      'aria-label',
      flipped
        ? t(
            'Sample flashcard showing back: journey. Tap to return.',
            'Kartu kilas contoh menampilkan belakang: perjalanan. Ketuk untuk kembali.',
          )
        : t(
            'Sample flashcard showing front: 旅 (tabi). Tap to turn it over.',
            'Kartu kilas contoh menampilkan depan: 旅 (tabi). Ketuk untuk membalik.',
          ),
    );
  }

  if (flashcard) {
    flashcard.addEventListener('click', () => {
      const flipped = flashcard.getAttribute('aria-pressed') === 'true';
      flashcard.setAttribute('aria-pressed', String(!flipped));
      syncFlashcardAccessibility();
    });
    syncFlashcardAccessibility();
  }

  /* ------------------------------------------------------------------ */
  /* Block 06 · Verified numbers odometer                               */
  /* ------------------------------------------------------------------ */

  const numbersSection = doc.querySelector('#numbers');
  const counterElements = [...doc.querySelectorAll('[data-counter]')];
  let countersComplete = false;
  let counterFrame = null;

  function renderCounters(progress = 1) {
    const eased = 1 - Math.pow(1 - progress, 3);
    counterElements.forEach((el) => {
      const target = Number(el.dataset.counter) || 0;
      const value = progress >= 1 ? target : Math.round(target * eased);
      el.textContent = formatInt(value);
    });
  }

  function startCounters() {
    if (countersComplete || !counterElements.length) return;
    countersComplete = true;
    if (isReducedMotion()) {
      renderCounters(1);
      return;
    }
    const startTime = performance.now();
    const duration = 900;
    const step = (now) => {
      const progress = clamp((now - startTime) / duration, 0, 1);
      renderCounters(progress);
      if (progress < 1) {
        counterFrame = requestAnimationFrame(step);
      } else {
        counterFrame = null;
      }
    };
    counterFrame = requestAnimationFrame(step);
  }

  if (numbersSection && counterElements.length) {
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            startCounters();
            observer.disconnect();
          }
        },
        { threshold: 0.25 },
      );
      observer.observe(numbersSection);
    } else {
      startCounters();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Block 07 · Yoshida Trail Ascent Telemetry                          */
  /* ------------------------------------------------------------------ */

  const STATION_COPY = [
    {
      btnLabel: ['5th Stn', 'Pos 5'],
      eyebrow: ['01 / TRAILHEAD ONBOARDING', '01 / ORIENTASI AWAL JALUR'],
      title: ['Fuji Subaru Line 5th Station', 'Pos 5 Fuji Subaru Line'],
      stage: ['Level 0 · Kana', 'Level 0 · Kana'],
      benchmark: ['92 Kana · 0 Kanji', '92 Kana · 0 Kanji'],
      body: [
        'At 2,305 m, most Yoshida Trail climbers take their first breath and check their gear. NihonPath Step 01 starts just as calmly—mastering all 92 basic Hiragana and Katakana shapes and sounds so every word after stands on solid ground.',
        'Pada ketinggian 2.305 m, sebagian besar pendaki Jalur Yoshida mulai menyesuaikan diri. NihonPath Langkah 01 dimulai setenang itu—menguasai seluruh 92 karakter dasar Hiragana dan Katakana beserta bunyinya agar fondasi belajar kokoh.',
      ],
    },
    {
      btnLabel: ['6th Stn', 'Pos 6'],
      eyebrow: ['02 / FIRST ASCENT & CORE RECALL', '02 / PENDAKIAN AWAL & INGATAN INTI'],
      title: ['6th Station Safety Guidance Center', 'Pusat Panduan Pos 6'],
      stage: ['Level N5 · Foundation', 'Level N5 · Fondasi'],
      benchmark: ['~103 Kanji Est. · ~800 Words Est.', 'Est. ~103 Kanji · Est. ~800 Kata'],
      body: [
        'Climbing 85 m across 1.4 km (T+ 01:00:00) establishes your pacing. NihonPath Step 02 builds a daily spaced-repetition habit around roughly 103 foundational Kanji and 800 everyday words before forgetting sets in.',
        'Kenaikan 85 m sejauh 1,4 km (T+ 01:00:00) membentuk ritme napas. NihonPath Langkah 02 membangun kebiasaan pengulangan berjeda harian pada sekitar 103 Kanji dasar dan 800 kosakata sehari-hari sebelum terlupakan.',
      ],
    },
    {
      btnLabel: ['7th Stn', 'Pos 7'],
      eyebrow: ['03 / ROCKY GRADE & BILINGUAL CONTEXT', '03 / JALUR BERBATU & KONTEKS DWIBAHASA'],
      title: ['7th Station Start · Hinodekan', 'Awal Pos 7 · Hinodekan'],
      stage: ['Level N4 · Build', 'Level N4 · Bangun'],
      benchmark: ['~300 Kanji Est. · ~1,500 Words Est.', 'Est. ~300 Kanji · Est. ~1.500 Kata'],
      body: [
        'At 2,700 m (3.2 km), the forest path turns into steep volcanic rock. NihonPath Step 03 introduces graded reading and clear grammar notes written directly in English and Bahasa Indonesia before learners hit the intermediate wall.',
        'Pada 2.700 m (3,2 km), jalur hutan berubah menjadi batu vulkanik terjal. NihonPath Langkah 03 menghadirkan bacaan bertingkat dan catatan tata bahasa langsung dalam bahasa Inggris dan Bahasa Indonesia sebelum pelajar menabrak dinding tingkat menengah.',
      ],
    },
    {
      btnLabel: ['8th Stn', 'Pos 8'],
      eyebrow: ['04 / THIN AIR & OFFLINE RESILIENCE', '04 / UDARA TIPIS & KETANGGUHAN LURING'],
      title: ['8th Station Start · Taishikan', 'Awal Pos 8 · Taishikan'],
      stage: ['Level N3–N2 · Deepen', 'Level N3–N2 · Dalami'],
      benchmark: ['1,026 MEXT Kyōiku Kanji', '1.026 Kanji Kyōiku MEXT'],
      body: [
        'By 3,100 m (5.0 km), air thins and mobile signal fades. NihonPath Step 04 runs local-first SQLite / IndexedDB content packs—keeping all 1,026 MEXT elementary school (Kyōiku) Kanji and audio available on MRT commutes or flights without coverage.',
        'Di ketinggian 3.100 m (5,0 km), udara menipis dan sinyal menghilang. NihonPath Langkah 04 mengandalkan paket konten lokal SQLite / IndexedDB—menjaga seluruh 1.026 Kanji Kyōiku MEXT tetap siap dipelajari di MRT maupun pesawat tanpa koneksi.',
      ],
    },
    {
      btnLabel: ['Summit', 'Puncak'],
      eyebrow: ['05 / SUMMIT MASTERY', '05 / PENGUASAAN PUNCAK'],
      title: ['Mount Fuji Summit · Kengamine', 'Puncak Gunung Fuji · Kengamine'],
      stage: ['Level N1 · Full Literacy', 'Level N1 · Literasi Penuh'],
      benchmark: ['2,136 Official MEXT Jōyō Kanji', '2.136 Kanji Jōyō Resmi MEXT'],
      body: [
        'Reaching 3,776 m (+1,471 m gain) across 7.5 km in 6h 30m opens the horizon. NihonPath Step 05 completes the 2,136 official MEXT Jōyō Kanji roadmap so you can read native Japanese books, essays, and media with clarity.',
        'Mencapai 3.776 m (+1.471 m kenaikan) sejauh 7,5 km dalam 6 jam 30 menit membuka cakrawala. NihonPath Langkah 05 menuntaskan seluruh 2.136 Kanji Jōyō resmi MEXT agar Anda dapat membaca buku dan media asli Jepang dengan percaya diri.',
      ],
    },
  ];

  const ascentScroll = doc.querySelector('#ascent-scroll');
  const hudTime = doc.querySelector('#hud-time');
  const hudElevation = doc.querySelector('#hud-elevation');
  const hudGain = doc.querySelector('#hud-gain');
  const hudDistance = doc.querySelector('#hud-distance');
  const hudTemperature = doc.querySelector('#hud-temperature');
  const hudStage = doc.querySelector('#hud-stage');
  const hudKanji = doc.querySelector('#hud-kanji');
  const profileGrid = doc.querySelector('#profile-grid');
  const profileArea = doc.querySelector('#profile-area');
  const profileRidge = doc.querySelector('#profile-ridge');
  const profileProgress = doc.querySelector('#profile-progress');
  const profileStations = doc.querySelector('#profile-stations');
  const profileCursor = doc.querySelector('#profile-cursor');
  const profileBeacon = doc.querySelector('#profile-beacon');
  const profileBeaconRing = doc.querySelector('#profile-beacon-ring');
  const profileSkyStop = doc.querySelector('#profile-sky-stop');
  const fujiCone = doc.querySelector('#fuji-cone');
  const fujiSnow = doc.querySelector('#fuji-snow');
  const fujiSwitchbacks = doc.querySelector('#fuji-switchbacks');
  const profileStars = doc.querySelector('#profile-stars');
  const profileSun = doc.querySelector('#profile-sun');
  const profileSunGlow = doc.querySelector('#profile-sun-glow');
  const profileClimber = doc.querySelector('#profile-climber');
  const climberBeam = doc.querySelector('#climber-beam');
  const climberLegBack = doc.querySelector('#climber-leg-back');
  const climberLegFront = doc.querySelector('#climber-leg-front');
  const climberArm = doc.querySelector('#climber-arm');
  const climberPole = doc.querySelector('#climber-pole');
  const climberTag = doc.querySelector('#climber-tag');
  const climberTagBg = doc.querySelector('#climber-tag-bg');
  const climberTagText = doc.querySelector('#climber-tag-text');
  const stationControls = doc.querySelector('#station-controls');
  const stationFacts = doc.querySelector('#station-facts');
  const stationAnnouncement = doc.querySelector('#station-announcement');

  let telemetryProgress = isReducedMotion() ? 1 : 0;
  let lastStationIndex = -1;
  let manualStationLock = false;
  let stationButtons = [];
  let stationFactCards = [];
  let svgStationDots = [];

  function createSvgElement(tag, attrs = {}) {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [key, val] of Object.entries(attrs)) {
      el.setAttribute(key, String(val));
    }
    return el;
  }

  function buildTelemetryProfile() {
    if (!profileGrid || !profileArea || !profileRidge || !profileStations) return;

    const gridFragment = doc.createDocumentFragment();
    for (const elev of [2305, 2700, 3100, 3500, 3776]) {
      const pt = plotPoint({ distance: 0, elevation: elev });
      gridFragment.append(
        createSvgElement('line', {
          x1: 70,
          y1: pt.y.toFixed(1),
          x2: 1054,
          y2: pt.y.toFixed(1),
          stroke: '#A6ADBB',
          'stroke-opacity': '0.16',
          'stroke-dasharray': elev === 2305 ? '' : '3 5',
        }),
      );
      const label = createSvgElement('text', {
        x: 62,
        y: (pt.y + 4).toFixed(1),
        'text-anchor': 'end',
        fill: '#A6ADBB',
        'font-size': '10',
      });
      label.textContent = `${formatInt(elev)} m`;
      gridFragment.append(label);
    }

    stations.forEach((station) => {
      const pt = plotPoint(station);
      gridFragment.append(
        createSvgElement('line', {
          x1: pt.x.toFixed(1),
          y1: 24,
          x2: pt.x.toFixed(1),
          y2: 298,
          stroke: '#A6ADBB',
          'stroke-opacity': '0.12',
        }),
      );
      const xLabel = createSvgElement('text', {
        x: pt.x.toFixed(1),
        y: 318,
        'text-anchor':
          station.distance === 7.5 ? 'end' : station.distance === 0 ? 'start' : 'middle',
        fill: '#A6ADBB',
        'font-size': '10',
      });
      xLabel.textContent = `${formatDecimal(station.distance, 1)} km`;
      gridFragment.append(xLabel);
    });
    profileGrid.replaceChildren(gridFragment);

    const points = stations.map(plotPoint);
    const ridgePath = points
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');
    profileRidge.setAttribute('d', ridgePath);
    profileArea.setAttribute('d', `${ridgePath} L1054 298 L70 298 Z`);

    if (fujiCone) {
      fujiCone.setAttribute('d', `${ridgePath} L1062 24 L1070 29 L1084 150 L1084 298 L70 298 Z`);
    }
    if (fujiSnow) {
      const p3 = points[3];
      const p4 = points[4];
      const snowY = 128;
      const ratio = (p3.y - snowY) / (p3.y - p4.y);
      const snowX = p3.x + (p4.x - p3.x) * ratio;
      fujiSnow.setAttribute(
        'd',
        `M${snowX.toFixed(1)} ${snowY} L${p4.x.toFixed(1)} ${p4.y.toFixed(1)} L1062 24 L1070 29 L1080 118 L1058 106 L1042 126 L1018 96 L986 130 L954 102 L914 134 L880 112 L836 134 L806 118 Z`,
      );
    }
    if (fujiSwitchbacks) {
      const paths = [];
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const steps = 4;
        const zig = [];
        for (let s = 0; s <= steps; s += 1) {
          const tStep = s / steps;
          const x = a.x + (b.x - a.x) * tStep;
          const y = a.y + (b.y - a.y) * tStep + (s % 2 === 1 ? 8 : 3);
          zig.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(1)} ${Math.min(296, y).toFixed(1)}`);
        }
        paths.push(zig.join(' '));
      }
      paths.push(
        `M${points[4].x.toFixed(1)} ${(points[4].y + 8).toFixed(1)} Q985 130 925 276`,
        'M1030 48 Q915 155 815 288',
        'M960 78 Q830 185 695 292',
      );
      fujiSwitchbacks.setAttribute('d', paths.join(' '));
    }

    if (fujiCone) {
      fujiCone.setAttribute('d', `${ridgePath} L1062 24 L1070 29 L1084 150 L1084 298 L70 298 Z`);
    }
    if (fujiSnow) {
      const p3 = points[3];
      const p4 = points[4];
      const snowY = 128;
      const ratio = (p3.y - snowY) / (p3.y - p4.y);
      const snowX = p3.x + (p4.x - p3.x) * ratio;
      fujiSnow.setAttribute(
        'd',
        `M${snowX.toFixed(1)} ${snowY} L${p4.x.toFixed(1)} ${p4.y.toFixed(1)} L1062 24 L1070 29 L1080 118 L1058 106 L1042 126 L1018 96 L986 130 L954 102 L914 134 L880 112 L836 134 L806 118 Z`,
      );
    }
    if (fujiSwitchbacks) {
      const paths = [];
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        const steps = 4;
        const zig = [];
        for (let s = 0; s <= steps; s += 1) {
          const tStep = s / steps;
          const x = a.x + (b.x - a.x) * tStep;
          const y = a.y + (b.y - a.y) * tStep + (s % 2 === 1 ? 8 : 3);
          zig.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(1)} ${Math.min(296, y).toFixed(1)}`);
        }
        paths.push(zig.join(' '));
      }
      paths.push(
        `M${points[4].x.toFixed(1)} ${(points[4].y + 8).toFixed(1)} Q985 130 925 276`,
        'M1030 48 Q915 155 815 288',
        'M960 78 Q830 185 695 292',
      );
      fujiSwitchbacks.setAttribute('d', paths.join(' '));
    }

    const dotsFragment = doc.createDocumentFragment();
    svgStationDots = points.map((pt, idx) => {
      const g = createSvgElement('g', {
        class: 'station-marker',
        style: 'cursor: pointer',
        'aria-hidden': 'true',
      });
      const landmark = createSvgElement('g', {
        transform: `translate(${(pt.x + (idx === 0 ? 15 : idx === 4 ? 5 : 0)).toFixed(1)}, ${pt.y.toFixed(1)})`,
        'aria-hidden': 'true',
      });
      if (idx === 0 || idx === 4) {
        // Torii gate landmark at trailhead (5th Station) and Summit (Kengamine)
        landmark.append(
          createSvgElement('path', {
            d: 'M-8 -13 Q0 -11 8 -13 M-7 -9 H7 M-4 -12 V0 M4 -12 V0',
            fill: 'none',
            stroke: idx === 4 ? '#F5B041' : '#FF5E62',
            'stroke-width': '1.5',
            'stroke-linecap': 'round',
          }),
        );
        if (idx === 4) {
          landmark.append(
            createSvgElement('circle', { cx: '0', cy: '-17', r: '2.2', fill: '#F5B041' }),
          );
        }
      } else {
        // Mountain hut (yamagoya) landmark at 6th, 7th, and 8th stations
        landmark.append(
          createSvgElement('path', {
            d: 'M-9 0 V-7 L0 -12 L9 -7 V0 Z',
            fill: '#181d2b',
            stroke: '#A6ADBB',
            'stroke-width': '1.1',
            'stroke-linejoin': 'round',
          }),
          createSvgElement('rect', {
            x: '-2.5',
            y: '-5.5',
            width: '5',
            height: '3.2',
            fill: '#F5B041',
            opacity: '.75',
          }),
        );
      }

      const circle = createSvgElement('circle', {
        cx: pt.x.toFixed(1),
        cy: pt.y.toFixed(1),
        r: '5',
        fill: '#121520',
        stroke: '#A6ADBB',
        'stroke-width': '2',
      });
      const caption = createSvgElement('text', {
        x: pt.x.toFixed(1),
        y: (idx === 4 ? pt.y + 18 : pt.y - 16).toFixed(1),
        'text-anchor': idx === 4 ? 'end' : idx === 0 ? 'start' : 'middle',
        fill: '#A6ADBB',
        'font-size': '10',
      });
      caption.textContent = `0${idx + 1}`;
      g.append(landmark, circle, caption);
      g.addEventListener('click', () => jumpToStation(idx));
      dotsFragment.append(g);
      return { circle, caption };
    });
    profileStations.replaceChildren(dotsFragment);
  }

  function buildTelemetryControlsAndCards() {
    if (stationControls) {
      const btnFragment = doc.createDocumentFragment();
      stationButtons = stations.map((station, idx) => {
        const copy = STATION_COPY[idx];
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', 'false');
        const labelSpan = doc.createElement('span');
        labelSpan.textContent = `0${idx + 1} · ${t(...copy.btnLabel)}`;
        const elevText = doc.createTextNode(`${formatInt(station.elevation)} m`);
        btn.append(labelSpan, elevText);
        btn.addEventListener('click', () => jumpToStation(idx));
        btnFragment.append(btn);
        return btn;
      });
      stationControls.replaceChildren(btnFragment);
    }

    if (stationFacts) {
      const cardsFragment = doc.createDocumentFragment();
      stationFactCards = stations.map((station, idx) => {
        const copy = STATION_COPY[idx];
        const gain = station.elevation - 2305;
        const temp = 15.4 - 0.0065 * gain;

        const card = doc.createElement('article');
        card.className = 'station-fact';

        const eyebrow = doc.createElement('p');
        eyebrow.className = 'eyebrow';
        eyebrow.textContent = t(...copy.eyebrow);

        const heading = doc.createElement('h3');
        heading.textContent = t(...copy.title);

        const metrics = doc.createElement('p');
        metrics.className = 'fact-metrics';
        metrics.textContent =
          `T+ ${ascentClock(station.minutes * 60)} · ${formatInt(station.elevation)} m (+${formatInt(gain)} m)\n` +
          `${formatDecimal(station.distance, 1)} km · ${formatDecimal(temp, 1)} °C · ${t(...copy.benchmark)}`;

        const desc = doc.createElement('p');
        desc.textContent = t(...copy.body);

        card.append(eyebrow, heading, metrics, desc);
        cardsFragment.append(card);
        return card;
      });
      stationFacts.replaceChildren(cardsFragment);
      decorateBrandText(stationFacts);
    }
  }

  function renderTelemetry(progress, announce = false) {
    telemetryProgress = clamp(progress, 0, 1);
    const sample = sampleAscent(telemetryProgress);
    const pt = plotPoint(sample);

    if (hudTime) hudTime.textContent = `T+ ${ascentClock(sample.seconds)}`;
    if (hudElevation) hudElevation.textContent = formatInt(sample.elevation);
    if (hudGain) hudGain.textContent = `+${formatInt(sample.gain)} M`;
    if (hudDistance) hudDistance.textContent = formatDecimal(sample.distance, 1);
    if (hudTemperature) hudTemperature.textContent = formatDecimal(sample.temperature, 1);
    if (hudStage) hudStage.textContent = t(...STATION_COPY[sample.index].stage);
    if (hudKanji) hudKanji.textContent = formatInt(sample.kanji);

    if (profileProgress) {
      const pts = [plotPoint(stations[0])];
      for (let i = 1; i < stations.length; i += 1) {
        if (sample.distance + 1e-6 >= stations[i].distance) {
          pts.push(plotPoint(stations[i]));
        } else {
          pts.push(pt);
          break;
        }
      }
      profileProgress.setAttribute(
        'd',
        pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
      );
    }

    if (profileCursor) {
      profileCursor.setAttribute('x1', pt.x.toFixed(1));
      profileCursor.setAttribute('x2', pt.x.toFixed(1));
      profileCursor.setAttribute('y1', pt.y.toFixed(1));
    }
    if (profileBeacon) {
      profileBeacon.setAttribute('cx', pt.x.toFixed(1));
      profileBeacon.setAttribute('cy', pt.y.toFixed(1));
    }
    if (profileBeaconRing) {
      profileBeaconRing.setAttribute('cx', pt.x.toFixed(1));
      profileBeaconRing.setAttribute('cy', pt.y.toFixed(1));
    }
    if (profileSkyStop) {
      const r = Math.round(32 + telemetryProgress * 76);
      const g = Math.round(36 + telemetryProgress * 38);
      const b = Math.round(57 - telemetryProgress * 19);
      profileSkyStop.setAttribute('stop-color', `rgb(${r}, ${g}, ${b})`);
    }
    if (profileSun && profileSunGlow) {
      const sunY = (185 - telemetryProgress * 133).toFixed(1);
      profileSun.setAttribute('cy', sunY);
      profileSun.setAttribute('opacity', (0.15 + telemetryProgress * 0.8).toFixed(2));
      profileSunGlow.setAttribute('cy', sunY);
      profileSunGlow.setAttribute('opacity', (0.18 + telemetryProgress * 0.77).toFixed(2));
    }
    if (profileStars) {
      profileStars.setAttribute('opacity', (0.85 - telemetryProgress * 0.75).toFixed(2));
    }
    if (profileClimber) {
      profileClimber.setAttribute('transform', `translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`);
      const atSummit = telemetryProgress >= 0.995;
      if (atSummit) {
        climberLegBack?.setAttribute('d', 'M0,-9 L-3,-4 L-4,0');
        climberLegFront?.setAttribute('d', 'M0,-9 L3,-4 L4,0');
        climberArm?.setAttribute('d', 'M1,-17 L5,-24 L7,-28');
        if (climberPole) {
          climberPole.setAttribute('x1', '7');
          climberPole.setAttribute('y1', '-32');
          climberPole.setAttribute('x2', '8');
          climberPole.setAttribute('y2', '-14');
        }
        climberBeam?.setAttribute('opacity', '0');
      } else {
        const stride = isReducedMotion() ? 0 : Math.sin(telemetryProgress * Math.PI * 42);
        climberLegFront?.setAttribute(
          'd',
          `M0,-9 L${(3 + stride * 3.5).toFixed(1)},${(-4 - Math.max(0, stride) * 1.5).toFixed(1)} L${(4 + stride * 4.5).toFixed(1)},0`,
        );
        climberLegBack?.setAttribute(
          'd',
          `M0,-9 L${(-3 - stride * 3.5).toFixed(1)},${(-4 - Math.max(0, -stride) * 1.5).toFixed(1)} L${(-5 - stride * 4.5).toFixed(1)},0`,
        );
        climberArm?.setAttribute(
          'd',
          `M1,-17 L${(6 - stride * 1.5).toFixed(1)},-14 L${(9 - stride * 2).toFixed(1)},${(-16 - stride * 1.5).toFixed(1)}`,
        );
        if (climberPole) {
          climberPole.setAttribute('x1', (9 - stride * 2).toFixed(1));
          climberPole.setAttribute('y1', (-18 - stride * 1.5).toFixed(1));
          climberPole.setAttribute('x2', (11 - stride * 2.5).toFixed(1));
          climberPole.setAttribute('y2', '0');
        }
        climberBeam?.setAttribute(
          'opacity',
          clamp(1 - telemetryProgress / 0.85, 0, 0.9).toFixed(2),
        );
      }
      if (climberTagText && climberTagBg && climberTag) {
        const label = atSummit
          ? t('SUMMIT · 3,776 m', 'PUNCAK · 3.776 m')
          : `${formatInt(sample.elevation)} m`;
        const boxWidth = atSummit ? 108 : 66;
        climberTagText.textContent = label;
        climberTagBg.setAttribute('width', String(boxWidth));
        climberTagBg.setAttribute('x', String(-boxWidth / 2));
        const offsetX = clamp(pt.x, 108, 1020) - pt.x;
        climberTag.setAttribute('transform', `translate(${offsetX.toFixed(1)}, -34)`);
      }
    }

    svgStationDots.forEach((dot, idx) => {
      const reached = idx <= sample.index;
      dot.circle.setAttribute('stroke', reached ? '#F5B041' : '#A6ADBB');
      dot.circle.setAttribute('fill', idx === sample.index ? '#F5B041' : '#121520');
      dot.caption.setAttribute('fill', idx === sample.index ? '#F5B041' : '#A6ADBB');
    });

    stationButtons.forEach((btn, idx) => {
      btn.setAttribute('aria-pressed', String(idx === sample.index));
    });
    stationFactCards.forEach((card, idx) => {
      card.classList.toggle('is-current', idx === sample.index);
    });

    if (announce && sample.index !== lastStationIndex && stationAnnouncement) {
      const copy = STATION_COPY[sample.index];
      stationAnnouncement.textContent = `${t(...copy.title)} — ${formatInt(sample.elevation)} m, ${t(...copy.stage)}`;
    }
    lastStationIndex = sample.index;
  }

  function jumpToStation(index) {
    const station = stations[index];
    if (!station) return;
    const targetProgress = station.distance / 7.5;

    const scrollable = ascentScroll ? ascentScroll.offsetHeight - window.innerHeight : 0;
    if (ascentScroll && !isReducedMotion() && scrollable > 80) {
      manualStationLock = false;
      const top = ascentScroll.getBoundingClientRect().top + window.scrollY;
      const destination = top + scrollable * targetProgress;
      window.scrollTo({ top: destination, behavior: 'smooth' });
    } else {
      manualStationLock = true;
    }

    renderTelemetry(targetProgress, true);
    if (stationFactCards[index] && window.innerWidth <= 800 && stationFacts) {
      const card = stationFactCards[index];
      stationFacts.scrollTo({
        left: Math.max(0, card.offsetLeft - stationFacts.offsetLeft),
        behavior: isReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }

  function updateTelemetryFromScroll(ascentHeight, ascentRect, innerHeight) {
    if (!ascentScroll || isReducedMotion() || manualStationLock) return;
    const vh = innerHeight ?? window.innerHeight;
    const totalHeight = ascentHeight ?? ascentScroll.offsetHeight;
    const scrollable = totalHeight - vh;
    if (scrollable <= 80) return;
    const rect = ascentRect ?? ascentScroll.getBoundingClientRect();
    const progress = clamp(-rect.top / scrollable, 0, 1);
    renderTelemetry(progress, false);
  }

  /* ------------------------------------------------------------------ */
  /* Block 08 · Learners carousel & spotlight                           */
  /* ------------------------------------------------------------------ */

  const learnerTrack = doc.querySelector('#learner-track');
  const learnersPrev = doc.querySelector('#learners-prev');
  const learnersNext = doc.querySelector('#learners-next');

  function updateCarouselButtons() {
    if (!learnerTrack || !learnersPrev || !learnersNext) return;
    const maxScroll = Math.max(0, learnerTrack.scrollWidth - learnerTrack.clientWidth);
    learnersPrev.disabled = learnerTrack.scrollLeft <= 4;
    learnersNext.disabled = learnerTrack.scrollLeft >= maxScroll - 4;
  }

  function scrollCarousel(direction) {
    if (!learnerTrack) return;
    const firstCard = learnerTrack.querySelector('.learner-card');
    const step = firstCard ? firstCard.getBoundingClientRect().width + 16 : 320;
    learnerTrack.scrollBy({
      left: direction * step,
      behavior: isReducedMotion() ? 'auto' : 'smooth',
    });
  }

  if (learnerTrack) {
    learnersPrev?.addEventListener('click', () => scrollCarousel(-1));
    learnersNext?.addEventListener('click', () => scrollCarousel(1));
    learnerTrack.addEventListener('scroll', updateCarouselButtons, { passive: true });
    learnerTrack.addEventListener(
      'pointermove',
      (event) => {
        const card = event.target.closest('.learner-card');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--spot-x', `${(event.clientX - rect.left).toFixed(1)}px`);
        card.style.setProperty('--spot-y', `${(event.clientY - rect.top).toFixed(1)}px`);
      },
      { passive: true },
    );
    learnerTrack.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        scrollCarousel(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        scrollCarousel(-1);
      }
    });
    updateCarouselButtons();
  }

  /* ------------------------------------------------------------------ */
  /* Block 10 · Kanji Stroke & Gravity Studio                           */
  /* ------------------------------------------------------------------ */

  const kanjiStudioRoot = doc.querySelector('#kanji-studio');
  const physicsArena = doc.querySelector('#physics-arena');
  const physicsPause = doc.querySelector('#physics-pause');
  const physicsTilt = doc.querySelector('#physics-tilt');
  const physicsReset = doc.querySelector('#physics-reset');
  const physicsStatus = doc.querySelector('#physics-status');
  const arenaCoord = physicsArena?.querySelector('.arena-coordinate');

  function restorePhysicsResetIcon() {
    if (!physicsReset) return;
    const svg = createSvgElement('svg', { class: 'icon', 'aria-hidden': 'true' });
    svg.append(createSvgElement('use', { href: '#repeat' }));
    physicsReset.replaceChildren(svg);
    physicsReset.setAttribute('aria-label', t('Reset tile positions', 'Atur ulang posisi ubin'));
  }

  const studio = kanjiStudioRoot ? initKanjiStudio({ root: kanjiStudioRoot, t, kanjiData }) : null;

  const physics = physicsArena
    ? initPhysics({
        arena: physicsArena,
        pauseButton: physicsPause,
        tiltButton: physicsTilt,
        resetButton: physicsReset,
        status: physicsStatus,
        onSelect(glyph) {
          if (studio?.selectKanji(glyph)) {
            showToast(
              t(
                `Loaded 「${glyph}」 into the Writing Desk`,
                `Karakter 「${glyph}」 dimuat ke Meja Menulis`,
              ),
            );
          }
        },
        t,
      })
    : null;

  restorePhysicsResetIcon();

  if (physicsArena && arenaCoord) {
    physicsArena.addEventListener(
      'pointermove',
      (event) => {
        const rect = physicsArena.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const nx = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        const ny = clamp((event.clientY - rect.top) / rect.height, 0, 1);
        arenaCoord.textContent = `X: ${nx.toFixed(2)} / Y: ${ny.toFixed(2)}`;
      },
      { passive: true },
    );
  }

  /* ------------------------------------------------------------------ */
  /* Block 11 · Copy buttons & mailto contact form                      */
  /* ------------------------------------------------------------------ */

  const copyAddressBtn = doc.querySelector('#copy-address');
  const copyEmailBtn = doc.querySelector('#copy-email');
  const contactForm = doc.querySelector('#contact-form');
  const nameInput = doc.querySelector('#contact-name');
  const emailInput = doc.querySelector('#contact-email');
  const levelSelect = doc.querySelector('#contact-level');
  const messageInput = doc.querySelector('#contact-message');
  const updatesCheckbox = doc.querySelector('#contact-updates');
  const errorName = doc.querySelector('#error-name');
  const errorEmail = doc.querySelector('#error-email');
  const errorMessage = doc.querySelector('#error-message');
  const formStatus = doc.querySelector('#form-status');
  const emailDraftLink = doc.querySelector('#email-draft-link');

  const activeErrors = { name: null, email: null, message: null };
  let formSubmittedSuccess = false;

  async function copyText(text, successEn, successId) {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      const textarea = doc.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      doc.body.append(textarea);
      textarea.select();
      try {
        copied = doc.execCommand('copy');
      } catch {
        copied = false;
      }
      textarea.remove();
    }
    showToast(
      copied
        ? t(successEn, successId)
        : t(
            'Copy failed. Please select and copy manually.',
            'Gagal menyalin. Silakan salin manual.',
          ),
    );
  }

  copyAddressBtn?.addEventListener('click', () =>
    copyText(
      STUDIO_ADDRESS,
      'Studio address copied to clipboard.',
      'Alamat studio disalin ke papan klip.',
    ),
  );

  copyEmailBtn?.addEventListener('click', () =>
    copyText(STUDIO_EMAIL, 'Email copied to clipboard.', 'Email disalin ke papan klip.'),
  );

  function setFieldError(input, errorEl, key, errorPair) {
    activeErrors[key] = errorPair;
    if (!input || !errorEl) return;
    if (errorPair) {
      input.setAttribute('aria-invalid', 'true');
      errorEl.textContent = t(...errorPair);
    } else {
      input.removeAttribute('aria-invalid');
      errorEl.textContent = '';
    }
  }

  function validateForm() {
    let firstInvalid = null;
    const nameValue = nameInput?.value.trim() || '';
    if (!nameValue) {
      setFieldError(nameInput, errorName, 'name', [
        'Please enter your name.',
        'Mohon masukkan nama Anda.',
      ]);
      firstInvalid ??= nameInput;
    } else {
      setFieldError(nameInput, errorName, 'name', null);
    }

    const emailValue = emailInput?.value.trim() || '';
    if (!emailValue) {
      setFieldError(emailInput, errorEmail, 'email', [
        'Please enter your email address.',
        'Mohon masukkan alamat email Anda.',
      ]);
      firstInvalid ??= emailInput;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setFieldError(emailInput, errorEmail, 'email', [
        'Please enter a valid email address.',
        'Mohon masukkan alamat email yang valid.',
      ]);
      firstInvalid ??= emailInput;
    } else {
      setFieldError(emailInput, errorEmail, 'email', null);
    }

    const messageValue = messageInput?.value.trim() || '';
    if (messageValue.length < 2) {
      setFieldError(messageInput, errorMessage, 'message', [
        'Please enter a short message.',
        'Mohon tuliskan pesan singkat Anda.',
      ]);
      firstInvalid ??= messageInput;
    } else {
      setFieldError(messageInput, errorMessage, 'message', null);
    }

    return firstInvalid;
  }

  if (contactForm) {
    [
      [nameInput, errorName, 'name'],
      [emailInput, errorEmail, 'email'],
      [messageInput, errorMessage, 'message'],
    ].forEach(([input, errorEl, key]) => {
      input?.addEventListener('input', () => {
        if (activeErrors[key]) setFieldError(input, errorEl, key, null);
      });
    });

    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const firstInvalid = validateForm();
      if (firstInvalid) {
        formSubmittedSuccess = false;
        if (formStatus) {
          formStatus.textContent = t(
            'Please fix the highlighted fields above.',
            'Mohon perbaiki kolom yang ditandai di atas.',
          );
        }
        firstInvalid.focus();
        return;
      }

      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const level = levelSelect?.value || 'Kana';
      const wantUpdates = Boolean(updatesCheckbox?.checked);
      const message = messageInput.value.trim();

      const subject = t(
        `NihonPath Inquiry — ${name} (${level})`,
        `Pertanyaan NihonPath — ${name} (${level})`,
      );
      const bodyLines = [
        `${t('Name', 'Nama')}: ${name}`,
        `Email: ${email}`,
        `${t('Current Level', 'Level Saat Ini')}: ${level}`,
        `${t('First release updates', 'Kabar rilis pertama')}: ${
          wantUpdates ? t('Yes', 'Ya') : t('No', 'Tidak')
        }`,
        '',
        `${t('Message', 'Pesan')}:`,
        message,
      ];
      const mailtoHref =
        `mailto:${STUDIO_EMAIL}?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(bodyLines.join('\n'))}`;

      formSubmittedSuccess = true;
      if (emailDraftLink) {
        emailDraftLink.href = mailtoHref;
        emailDraftLink.hidden = false;
      }
      if (formStatus) {
        formStatus.textContent = t(
          'Email draft ready. Opening your email app…',
          'Draf email siap. Membuka aplikasi email Anda…',
        );
      }
      window.location.href = mailtoHref;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Bilingual switching (EN | ID)                                      */
  /* ------------------------------------------------------------------ */

  const languageButtons = [...doc.querySelectorAll('.language-switch button[data-language]')];

  function applyLanguage(nextLang) {
    currentLang = nextLang === 'id' ? 'id' : 'en';
    rootEl.lang = currentLang;
    doc.title = t('NihonPath — One step at a time', 'NihonPath — Selangkah demi selangkah');

    languageButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.language === currentLang));
    });

    doc.querySelectorAll('[data-en][data-id]').forEach((el) => {
      const value = el.dataset[currentLang];
      if (value !== undefined) {
        el.textContent = value.replaceAll('\\n', '\n');
      }
    });

    doc.querySelectorAll('[data-en-aria][data-id-aria]').forEach((el) => {
      const ariaKey = currentLang === 'id' ? 'idAria' : 'enAria';
      const label = el.dataset[ariaKey];
      if (label !== undefined) el.setAttribute('aria-label', label);
    });

    doc.querySelectorAll('[data-en-placeholder][data-id-placeholder]').forEach((el) => {
      const phKey = currentLang === 'id' ? 'idPlaceholder' : 'enPlaceholder';
      const placeholder = el.dataset[phKey];
      if (placeholder !== undefined) el.setAttribute('placeholder', placeholder);
    });

    decorateBrandText(doc.body);
    buildStoryWords();
    syncMenuToggleState();
    syncFlashcardAccessibility();
    if (countersComplete || counterFrame === null) renderCounters(1);

    buildTelemetryProfile();
    buildTelemetryControlsAndCards();
    renderTelemetry(telemetryProgress, false);

    studio?.updateLanguage();
    physics?.updateLanguage();
    restorePhysicsResetIcon();

    if (activeErrors.name) setFieldError(nameInput, errorName, 'name', activeErrors.name);
    if (activeErrors.email) setFieldError(emailInput, errorEmail, 'email', activeErrors.email);
    if (activeErrors.message) {
      setFieldError(messageInput, errorMessage, 'message', activeErrors.message);
    }
    if (formSubmittedSuccess && formStatus) {
      formStatus.textContent = t(
        'Email draft ready. Opening your email app…',
        'Draf email siap. Membuka aplikasi email Anda…',
      );
    }

    requestAnimationFrame(() => {
      updateActiveNav();
      updateCarouselButtons();
    });
  }

  languageButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.language && btn.dataset.language !== currentLang) {
        applyLanguage(btn.dataset.language);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /* Scroll / resize / reduced-motion orchestration                     */
  /* ------------------------------------------------------------------ */

  let scrollScheduled = false;

  function onScroll() {
    manualStationLock = false;
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      const y = window.scrollY;
      const vh = window.innerHeight;
      const reduced = isReducedMotion();

      // Batch DOM geometry reads before style/attribute writes to avoid reflows.
      const sectionRects = trackedSections.map((section) => section.getBoundingClientRect());
      let navMetrics = null;
      if (desktopNav && navIndicator && desktopNav.offsetParent !== null) {
        navMetrics = {
          navRect: desktopNav.getBoundingClientRect(),
          navLinkRects: navLinks.map((link) => link.getBoundingClientRect()),
        };
      }
      const heroHeight = !reduced && heroSection ? heroSection.offsetHeight : undefined;
      const storyRect =
        !reduced && storySection && storyWords.length
          ? storySection.getBoundingClientRect()
          : undefined;
      const canReadAscent = Boolean(ascentScroll && !reduced && !manualStationLock);
      const ascentHeight = canReadAscent ? ascentScroll.offsetHeight : undefined;
      const ascentRect =
        canReadAscent && ascentHeight - vh > 80 ? ascentScroll.getBoundingClientRect() : undefined;

      updateHeaderVisibility(y);
      updateActiveNav(sectionRects, y, vh, navMetrics);
      updateHeroParallax(y, heroHeight);
      updateStory(storyRect, vh);
      updateTelemetryFromScroll(ascentHeight, ascentRect, vh);
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener(
    'resize',
    () => {
      updateNavIndicator();
      updateCarouselButtons();
      updateTelemetryFromScroll();
    },
    { passive: true },
  );

  reducedMotionQuery.addEventListener('change', (event) => {
    manualStationLock = false;
    if (event.matches) {
      renderCounters(1);
      renderTelemetry(1, false);
    }
    updateHeroParallax();
    updateStory();
  });

  applyLanguage(currentLang);
  updateHeaderVisibility();
  updateHeroParallax();
  updateTelemetryFromScroll();
})();
