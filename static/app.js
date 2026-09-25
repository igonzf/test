const BANKS = [
  './questions/all_general_verified_130.json',
  './questions/all_technical_verified_330.json',
];
const STORAGE_KEY = 'oposicion-29770-stats-v1';

let bank = [];
let questions = [];
let current = 0;
let startedAt = 0;
let mockMode = false;
let mockAnswers = [];
let mockEndsAt = 0;
let timerHandle = null;

const $ = (id) => document.getElementById(id);

function loadLocalStats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { attempts: [] };
  } catch {
    return { attempts: [] };
  }
}

function saveLocalStats(stats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

function normalizeQuestion(q, idx) {
  return {
    ...q,
    id: q.id || `${q.topic_id}-${idx + 1}`,
    concept_tags: q.concept_tags || [],
  };
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function serializeQuestion(q, includeSolution = false) {
  const order = includeSolution ? [0, 1, 2, 3] : shuffle([0, 1, 2, 3]);
  const data = {
    id: q.id,
    topic_id: q.topic_id,
    subtopic: q.subtopic,
    difficulty: q.difficulty,
    question: q.question,
    answers: order.map((i) => q.answers[i]),
    answer_order: order,
  };
  if (includeSolution) {
    Object.assign(data, {
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      source_id: q.source_id,
      source_url: q.source_url,
      source_reference: q.source_reference,
      evidence: q.evidence,
    });
  }
  return data;
}

async function loadBank() {
  const batches = await Promise.all(BANKS.map(async (path) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`No se pudo cargar ${path}`);
    return res.json();
  }));
  bank = batches.flat().filter((q) => q.validation_result === 'verified').map(normalizeQuestion);
}

function getTopics() {
  const counts = new Map();
  for (const q of bank) counts.set(q.topic_id, (counts.get(q.topic_id) || 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([topic_id, total]) => ({ topic_id, total }));
}

function getQuestion(id) {
  return bank.find((q) => q.id === id);
}

function selectQuestions(mode, topicId, size) {
  const stats = loadLocalStats();
  let pool = bank;
  if (mode === 'topic') pool = bank.filter((q) => q.topic_id === topicId);
  if (mode === 'failed') {
    const failed = new Set(stats.attempts.filter((a) => !a.correct).map((a) => a.question_id));
    pool = bank.filter((q) => failed.has(q.id));
  }
  if (mode === 'mock') return shuffle(bank).slice(0, 50).map((q) => serializeQuestion(q));
  return shuffle(pool).slice(0, Math.min(size, pool.length)).map((q) => serializeQuestion(q));
}

function originalSelectedIndex(selected, order) {
  if (selected === null || selected === undefined) return null;
  return order[selected];
}

function recordAttempt(questionId, selectedAnswer, answerOrder, responseTime) {
  const q = getQuestion(questionId);
  const selected = originalSelectedIndex(selectedAnswer, answerOrder);
  const correct = selected === q.correct_answer;
  const stats = loadLocalStats();
  stats.attempts.push({
    question_id: questionId,
    selected_answer: selected,
    correct,
    created_at: new Date().toISOString(),
    response_time: responseTime,
  });
  saveLocalStats(stats);
  return { correct, question: serializeQuestion(q, true) };
}

function buildStats() {
  const stats = loadLocalStats();
  const topicStats = new Map();
  const conceptStats = new Map();
  for (const attempt of stats.attempts) {
    const q = getQuestion(attempt.question_id);
    if (!q) continue;
    addStat(topicStats, q.topic_id, attempt.correct, attempt.created_at);
    for (const concept of q.concept_tags) addStat(conceptStats, concept, attempt.correct, attempt.created_at);
  }
  const attempts = stats.attempts.length;
  const correct = stats.attempts.filter((a) => a.correct).length;
  return {
    attempts,
    correct,
    incorrect: attempts - correct,
    accuracy: attempts ? Number((correct / attempts).toFixed(4)) : null,
    topics: sortStats(topicStats),
    weak_concepts: sortStats(conceptStats).slice(0, 10),
  };
}

function addStat(map, key, correct, lastSeen) {
  const currentStat = map.get(key) || { attempts: 0, correct: 0, incorrect: 0, accuracy: 0, last_seen: null };
  currentStat.attempts += 1;
  currentStat.correct += correct ? 1 : 0;
  currentStat.incorrect += correct ? 0 : 1;
  currentStat.accuracy = Number((currentStat.correct / currentStat.attempts).toFixed(4));
  currentStat.last_seen = lastSeen;
  map.set(key, currentStat);
}

function sortStats(map) {
  return [...map.entries()]
    .map(([id, values]) => ({ id, ...values }))
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);
}

async function loadStatus() {
  $('status').textContent = `${bank.length} preguntas cargadas desde ${BANKS.length} bancos. Simulacro: ${bank.length >= 50 ? 'activo' : 'desactivado'}.`;
  $('mock').disabled = bank.length < 50;
  $('topic').innerHTML = getTopics().map((t) => `<option value="${t.topic_id}">${t.topic_id} (${t.total})</option>`).join('');
  loadStats();
}

function loadStats() {
  $('stats').textContent = JSON.stringify(buildStats(), null, 2);
}

function startQuiz(isMock = false) {
  mockMode = isMock;
  current = 0;
  mockAnswers = [];
  const mode = isMock ? 'mock' : $('mode').value;
  const topic = $('topic').value;
  const size = isMock ? 50 : Number($('size').value);
  questions = selectQuestions(mode, topic, size);
  if (!questions.length) {
    alert('No hay preguntas disponibles para ese modo.');
    return;
  }
  $('quiz').classList.remove('hidden');
  $('finishMock').classList.toggle('hidden', !mockMode);
  $('blankMock').classList.toggle('hidden', !mockMode);
  $('next').classList.add('hidden');
  if (mockMode) {
    mockEndsAt = Date.now() + 60 * 60 * 1000;
    timerHandle = setInterval(updateTimer, 1000);
    updateTimer();
  } else {
    $('timer').textContent = '';
    clearInterval(timerHandle);
  }
  showQuestion();
}

async function blankMockQuestion() {
  if (!mockMode) return;
  const q = questions[current];
  mockAnswers[current] = { question_id: q.id, selected_answer: null, answer_order: q.answer_order, response_time: (Date.now() - startedAt) / 1000 };
  if (current + 1 < questions.length) {
    current++;
    showQuestion();
  } else {
    finishMock();
  }
}

function updateTimer() {
  const left = Math.max(0, mockEndsAt - Date.now());
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000);
  $('timer').textContent = `${mins}:${String(secs).padStart(2, '0')}`;
  if (left === 0) finishMock();
}

function showQuestion() {
  const q = questions[current];
  startedAt = Date.now();
  $('progress').textContent = `${current + 1}/${questions.length} · ${q.topic_id} · ${q.subtopic}`;
  $('question').textContent = q.question;
  $('feedback').classList.add('hidden');
  $('next').classList.add('hidden');
  $('answers').innerHTML = q.answers.map((a, i) => `<button class="answer" data-i="${i}">${'ABCD'[i]}. ${escapeHtml(a)}</button>`).join('');
  document.querySelectorAll('.answer').forEach((btn) => btn.addEventListener('click', () => chooseAnswer(Number(btn.dataset.i))));
}

function chooseAnswer(selected) {
  const q = questions[current];
  const responseTime = (Date.now() - startedAt) / 1000;
  document.querySelectorAll('.answer').forEach((btn) => { btn.disabled = true; });
  if (mockMode) {
    mockAnswers[current] = { question_id: q.id, selected_answer: selected, answer_order: q.answer_order, response_time: responseTime };
    if (current + 1 < questions.length) {
      current++;
      showQuestion();
    } else {
      finishMock();
    }
    return;
  }
  const result = recordAttempt(q.id, selected, q.answer_order, responseTime);
  renderFeedback(result, selected);
  $('next').classList.remove('hidden');
  loadStats();
}

function renderFeedback(result, selected) {
  const q = result.question;
  const displayed = questions[current];
  const correctVisible = displayed.answer_order.indexOf(q.correct_answer);
  document.querySelectorAll('.answer').forEach((btn) => {
    const i = Number(btn.dataset.i);
    if (i === correctVisible) btn.classList.add('correct');
    if (i === selected && !result.correct) btn.classList.add('wrong');
  });
  $('feedback').innerHTML = `<strong>${result.correct ? 'Correcta' : 'Incorrecta'}</strong><br>
    Respuesta correcta: ${'ABCD'[correctVisible]}. ${escapeHtml(q.answers[q.correct_answer])}<br>
    ${escapeHtml(q.explanation)}<br>
    <small>Fuente: ${escapeHtml(q.source_id)}, ${escapeHtml(q.source_reference)}<br><a href="${escapeAttribute(q.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(q.source_url)}</a></small>`;
  $('feedback').classList.remove('hidden');
}

function nextQuestion() {
  current++;
  if (current >= questions.length) {
    $('quiz').classList.add('hidden');
    return;
  }
  showQuestion();
}

function finishMock() {
  clearInterval(timerHandle);
  const answers = questions.map((q, i) => mockAnswers[i] || { question_id: q.id, selected_answer: null, answer_order: q.answer_order, response_time: null });
  let score = 0;
  for (const answer of answers) {
    const result = recordAttempt(answer.question_id, answer.selected_answer, answer.answer_order, answer.response_time);
    if (result.correct) score += 1;
    else if (answer.selected_answer !== null) score -= 0.33;
  }
  $('feedback').innerHTML = `<strong>Simulacro finalizado</strong><br>Puntuación: ${score.toFixed(2)}/50<br>Nota: ${(score / 50 * 10).toFixed(2)}/10`;
  $('feedback').classList.remove('hidden');
  $('answers').innerHTML = '';
  $('question').textContent = 'Resultado del simulacro';
  $('finishMock').classList.add('hidden');
  $('blankMock').classList.add('hidden');
  loadStats();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

$('start').addEventListener('click', () => startQuiz(false));
$('mock').addEventListener('click', () => startQuiz(true));
$('next').addEventListener('click', nextQuestion);
$('blankMock').addEventListener('click', () => blankMockQuestion());
$('finishMock').addEventListener('click', () => finishMock());
$('resetStats').addEventListener('click', () => {
  if (confirm('¿Borrar las estadísticas guardadas en este navegador?')) {
    localStorage.removeItem(STORAGE_KEY);
    loadStats();
  }
});

loadBank().then(loadStatus).catch((err) => alert(err.message));
