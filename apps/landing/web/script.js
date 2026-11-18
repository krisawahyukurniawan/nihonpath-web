(() => {
  'use strict';

  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#navigation');

  function closeMenu() {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('is-open');
  }

  menuButton.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
    navigation.classList.toggle('is-open', !isOpen);
  });

  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.header')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });

  window.matchMedia('(min-width: 621px)').addEventListener('change', closeMenu);

  const cards = [
    { word: '旅', reading: 'たび · tabi', meaning: 'journey', indonesian: 'perjalanan' },
    { word: '学ぶ', reading: 'まなぶ · manabu', meaning: 'to learn', indonesian: 'belajar' },
    { word: '一歩', reading: 'いっぽ · ippo', meaning: 'one step', indonesian: 'satu langkah' },
  ];
  let cardIndex = 0;
  const revealButton = document.querySelector('#reveal-card');
  const nextButton = document.querySelector('#next-card');
  const cardAnswer = document.querySelector('#card-answer');

  revealButton.addEventListener('click', () => {
    cardAnswer.hidden = false;
    revealButton.hidden = true;
    revealButton.setAttribute('aria-expanded', 'true');
    nextButton.hidden = false;
    nextButton.focus({ preventScroll: true });
  });

  nextButton.addEventListener('click', () => {
    cardIndex = (cardIndex + 1) % cards.length;
    const card = cards[cardIndex];
    document.querySelector('#card-word').textContent = card.word;
    document.querySelector('#card-reading').textContent = card.reading;
    document.querySelector('#card-meaning').textContent = card.meaning;
    document.querySelector('#card-indonesian').textContent = card.indonesian;
    document.querySelector('#card-count').textContent = `0${cardIndex + 1} / 03`;
    cardAnswer.hidden = true;
    nextButton.hidden = true;
    revealButton.hidden = false;
    revealButton.setAttribute('aria-expanded', 'false');
    revealButton.focus({ preventScroll: true });
  });

  const curriculum = {
    kana: {
      symbol: 'あ',
      secondary: 'ア',
      badge: 'LEVEL 0 · KANA',
      title: 'Every great journey starts with あ.',
      description:
        'Meet hiragana and katakana, the building blocks of Japanese. Get comfortable with the sounds, shapes, and strokes that make everything else possible.',
      skills: ['Hiragana & katakana', 'Sound recognition', 'Writing practice'],
    },
    n5: {
      symbol: '日',
      secondary: '本',
      badge: 'JLPT N5 · FOUNDATION',
      title: 'Small words. Everyday discoveries.',
      description:
        'Build a foundation in everyday vocabulary, essential kanji, and simple sentence patterns. Begin to recognize the Japanese around you, one familiar word at a time.',
      skills: ['Everyday vocabulary', 'Essential kanji', 'Basic grammar'],
    },
    n4: {
      symbol: '話',
      secondary: 'す',
      badge: 'JLPT N4 · BUILD',
      title: 'Turn familiar words into new connections.',
      description:
        'Grow beyond the basics with more everyday expressions and grammar. Planned reading and listening activities help connect what you remember with what you understand.',
      skills: ['Everyday expressions', 'Graded reading', 'Listening practice'],
    },
    n3: {
      symbol: '世',
      secondary: '界',
      badge: 'JLPT N3 · EXPLORE',
      title: 'Open the door to a wider world.',
      description:
        'Bridge foundational and more advanced Japanese. Explore richer sentences, a broader vocabulary, and longer reading and listening activities in the planned intermediate curriculum.',
      skills: ['Intermediate grammar', 'Connected passages', 'Broader vocabulary'],
    },
    n2: {
      symbol: '読',
      secondary: 'む',
      badge: 'JLPT N2 · DEEPEN',
      title: 'Find the meaning between the lines.',
      description:
        'A later stage of the roadmap aims to develop more advanced reading and listening. Work toward understanding complex ideas, varied expressions, and the context behind them.',
      skills: ['Complex texts', 'Nuanced expressions', 'JLPT-style practice'],
    },
    n1: {
      symbol: '道',
      secondary: '先',
      badge: 'JLPT N1 · REFINE',
      title: 'Not the finish line. A new perspective.',
      description:
        'The long-term vision reaches toward N1 with advanced language and JLPT-style mock tests. Refine your understanding of abstract ideas and subtle meaning, while continuing to discover more.',
      skills: ['Advanced language', 'Subtle meaning', 'JLPT-style mock tests'],
    },
  };
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panel = document.querySelector('#level-panel');

  function selectLevel(tab, moveFocus = false) {
    const level = curriculum[tab.dataset.level];
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tab.id);
    const symbol = document.querySelector('#level-symbol');
    symbol.textContent = level.symbol;
    const secondary = document.createElement('span');
    secondary.textContent = level.secondary;
    symbol.append(secondary);
    document.querySelector('#level-badge').textContent = level.badge;
    document.querySelector('#level-title').textContent = level.title;
    document.querySelector('#level-description').textContent = level.description;
    document.querySelector('#level-skills').replaceChildren(
      ...level.skills.map((skill) => {
        const item = document.createElement('li');
        item.textContent = skill;
        return item;
      }),
    );
    const aside = document.querySelector('.path-aside p');
    aside.textContent = '';
    const intro = document.createTextNode(
      tab.dataset.level === 'kana' ? 'No experience?' : 'One step at a time.',
    );
    const emphasis = document.createElement('strong');
    emphasis.textContent =
      tab.dataset.level === 'kana' ? 'You’re in the right place.' : 'There’s more ahead.';
    aside.append(intro, document.createElement('br'), emphasis);
    if (moveFocus) tab.focus({ preventScroll: true });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectLevel(tab));
    tab.addEventListener('keydown', (event) => {
      let nextIndex;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex !== undefined) {
        event.preventDefault();
        selectLevel(tabs[nextIndex], true);
      }
    });
  });
})();
