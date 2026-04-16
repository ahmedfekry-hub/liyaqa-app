const cfg = window.LIYAQA_CONFIG;
const supabaseClient = window.supabase?.createClient?.(cfg.supabaseUrl, cfg.supabaseAnonKey);

const state = {
  session: null,
  profile: null,
  dailyMetrics: [],
  workouts: [],
  meals: [],
  workoutSessions: [],
  activeWorkout: null,
  timerStartedAt: null,
  elapsedSeconds: 0,
  timerRunning: false,
  timerInterval: null,
  storageMode: 'database',
  charts: {}
};

const els = {
  authView: qs('#authView'),
  appViews: qs('#appViews'),
  authMsg: qs('#authMsg'),
  logoutBtn: qs('#logoutBtn'),
  planBadge: qs('#planBadge'),
  planStatusText: qs('#planStatusText'),
  welcomeText: qs('#welcomeText'),
  viewTitle: qs('#viewTitle'),
  recommendations: qs('#recommendations'),
  workoutsList: qs('#workoutsList'),
  mealList: qs('#mealList'),
  adminWorkoutsList: qs('#adminWorkoutsList'),
  adminUsersList: qs('#adminUsersList'),
  subscriptionMsg: qs('#subscriptionMsg'),
  workoutPlayer: qs('#workoutPlayer'),
  workoutPlayerEmpty: qs('#workoutPlayerEmpty'),
  workoutPlayerActive: qs('#workoutPlayerActive'),
  workoutPlayerTitle: qs('#workoutPlayerTitle'),
  workoutPlayerMeta: qs('#workoutPlayerMeta'),
  workoutTimer: qs('#workoutTimer'),
  workoutProgressFill: qs('#workoutProgressFill'),
  workoutProgressText: qs('#workoutProgressText'),
  workoutMode: qs('#workoutMode'),
  workoutSessionMsg: qs('#workoutSessionMsg'),
  startWorkoutBtn: qs('#startWorkoutBtn'),
  pauseWorkoutBtn: qs('#pauseWorkoutBtn'),
  completeWorkoutBtn: qs('#completeWorkoutBtn'),
  cancelWorkoutBtn: qs('#cancelWorkoutBtn'),
  recentWorkoutSessions: qs('#recentWorkoutSessions')
};

init();

async function init() {
  if (!supabaseClient || cfg.supabaseUrl.includes('YOUR_')) {
    els.authMsg.textContent = 'ضع مفاتيح Supabase داخل config.js أولاً ثم أعد تحميل الصفحة.';
    bindUi();
    return;
  }

  bindUi();
  const { data: { session } } = await supabaseClient.auth.getSession();
  state.session = session;
  await applyAuthState();
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    await applyAuthState();
  });
}

function bindUi() {
  qsa('.nav-link').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  qsa('.tab').forEach(btn => btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab)));
  qs('#themeToggle').addEventListener('click', toggleTheme);
  qs('#loginForm').addEventListener('submit', onLogin);
  qs('#registerForm').addEventListener('submit', onRegister);
  qs('#dailyMetricsForm').addEventListener('submit', saveDailyMetrics);
  qs('#mealForm').addEventListener('submit', saveMeal);
  qs('#workoutAdminForm').addEventListener('submit', saveWorkout);
  qs('#logoutBtn').addEventListener('click', async () => { await supabaseClient.auth.signOut(); });
  qs('#refreshWorkoutsBtn').addEventListener('click', async () => {
    await loadWorkouts();
    await loadWorkoutSessions();
    renderWorkouts();
    renderWorkoutSessions();
  });
  qsa('.subscription-btn').forEach(btn => btn.addEventListener('click', onSubscribe));
  els.startWorkoutBtn?.addEventListener('click', toggleWorkoutTimer);
  els.pauseWorkoutBtn?.addEventListener('click', toggleWorkoutTimer);
  els.completeWorkoutBtn?.addEventListener('click', completeWorkoutSession);
  els.cancelWorkoutBtn?.addEventListener('click', cancelWorkoutSession);

  const savedTheme = localStorage.getItem('liyaqa_theme') || 'light';
  document.body.classList.toggle('dark', savedTheme === 'dark');
}

async function applyAuthState() {
  const loggedIn = !!state.session?.user;
  els.authView.classList.toggle('hidden', loggedIn);
  els.appViews.classList.toggle('hidden', !loggedIn);
  els.logoutBtn.classList.toggle('hidden', !loggedIn);

  if (!loggedIn) {
    stopTimer();
    state.profile = null;
    state.activeWorkout = null;
    state.workoutSessions = [];
    switchView('dashboard');
    return;
  }

  await loadProfile();
  await Promise.all([loadDailyMetrics(), loadMeals(), loadWorkouts(), loadWorkoutSessions()]);
  await maybeLoadAdminData();
  renderAll();
}

async function onLogin(e) {
  e.preventDefault();
  const email = qs('#loginEmail').value.trim();
  const password = qs('#loginPassword').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  els.authMsg.textContent = error ? error.message : 'تم تسجيل الدخول.';
}

async function onRegister(e) {
  e.preventDefault();
  const payload = {
    email: qs('#registerEmail').value.trim(),
    password: qs('#registerPassword').value,
    options: {
      data: {
        full_name: qs('#registerName').value.trim(),
        goal: qs('#registerGoal').value
      }
    }
  };
  const { error } = await supabaseClient.auth.signUp(payload);
  els.authMsg.textContent = error ? error.message : 'تم إنشاء الحساب. افحص البريد لتأكيده إذا كان التفعيل مطلوبًا.';
}

async function loadProfile() {
  const user = state.session.user;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!data && !error) {
    const starter = {
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || 'مستخدم جديد',
      goal: user.user_metadata?.goal || 'fitness',
      role: 'member',
      subscription_plan: 'free',
      subscription_status: 'inactive'
    };
    await supabaseClient.from('profiles').upsert(starter);
    state.profile = starter;
  } else {
    state.profile = data;
  }
}

async function loadDailyMetrics() {
  const { data } = await supabaseClient
    .from('daily_metrics')
    .select('*')
    .order('entry_date', { ascending: true })
    .limit(30);
  state.dailyMetrics = data || [];
}

async function loadMeals() {
  const { data } = await supabaseClient
    .from('meal_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  state.meals = data || [];
}

async function loadWorkouts() {
  const { data, error } = await supabaseClient
    .from('workout_programs')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Workout load error:', error);
    state.workouts = [];
    els.workoutsList.innerHTML = `<div class="muted">تعذر تحميل التمارين الآن.</div>`;
    return;
  }

  state.workouts = data || [];
}

async function loadWorkoutSessions() {
  const userId = state.session?.user?.id;
  if (!userId) {
    state.workoutSessions = [];
    return;
  }

  const { data, error } = await supabaseClient
    .from('workout_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(10);

  if (error) {
    console.warn('workout_sessions unavailable, using local storage fallback:', error.message || error);
    state.storageMode = 'local';
    state.workoutSessions = readLocalWorkoutSessions();
    return;
  }

  state.storageMode = 'database';
  state.workoutSessions = data || [];
}

async function maybeLoadAdminData() {
  const isAdmin = state.profile?.role === 'admin';
  qs('.admin-only').classList.toggle('hidden', !isAdmin);
  if (!isAdmin) return;
  const { data: users } = await supabaseClient
    .from('profiles')
    .select('id, full_name, email, role, subscription_plan, subscription_status')
    .order('created_at', { ascending: false });
  renderUsers(users || []);
}

async function saveDailyMetrics(e) {
  e.preventDefault();
  const record = {
    user_id: state.session.user.id,
    entry_date: new Date().toISOString().slice(0, 10),
    steps: num('#stepsInput'),
    calories: num('#caloriesInput'),
    water_cups: num('#waterInput'),
    sleep_hours: num('#sleepInput'),
    weight_kg: num('#weightInput'),
    heart_rate: num('#heartInput')
  };
  const { error } = await supabaseClient.from('daily_metrics').upsert(record, { onConflict: 'user_id,entry_date' });
  if (!error) {
    await loadDailyMetrics();
    renderAll();
  }
}

async function saveMeal(e) {
  e.preventDefault();
  const record = {
    user_id: state.session.user.id,
    meal_name: qs('#mealName').value.trim(),
    protein_g: num('#proteinInput'),
    carbs_g: num('#carbsInput'),
    fat_g: num('#fatInput')
  };
  const { error } = await supabaseClient.from('meal_logs').insert(record);
  if (!error) {
    e.target.reset();
    await loadMeals();
    renderMeals();
  }
}

async function saveWorkout(e) {
  e.preventDefault();
  const record = {
    name: qs('#adminWorkoutName').value.trim(),
    duration_minutes: num('#adminWorkoutDuration'),
    intensity: qs('#adminWorkoutIntensity').value,
    estimated_calories: num('#adminWorkoutCalories'),
    is_active: true,
    created_by: state.session.user.id
  };
  const { error } = await supabaseClient.from('workout_programs').insert(record);
  if (!error) {
    e.target.reset();
    await loadWorkouts();
    renderAdminWorkouts();
    renderWorkouts();
  }
}

async function onSubscribe(e) {
  const plan = e.currentTarget.dataset.plan;
  const link = cfg.stripeLinks[plan];
  if (!link || link.includes('test_')) {
    els.subscriptionMsg.textContent = 'أضف رابط Stripe الحقيقي لهذا الاشتراك داخل config.js.';
    return;
  }

  await supabaseClient.from('subscription_events').insert({
    user_id: state.session.user.id,
    event_type: 'checkout_started',
    payload: { plan, source: 'client_redirect' }
  });

  window.location.href = link + `?prefilled_email=${encodeURIComponent(state.session.user.email)}`;
}

function renderAll() {
  renderDashboard();
  renderMeals();
  renderWorkouts();
  renderWorkoutPlayer();
  renderWorkoutSessions();
  renderAdminWorkouts();
  updatePlanUi();
}

function renderDashboard() {
  const latest = state.dailyMetrics.at(-1) || {};
  const totalSessionMinutes = state.workoutSessions.reduce((sum, s) => sum + (s.completed_minutes || 0), 0);
  const totalSessionCalories = state.workoutSessions.reduce((sum, s) => sum + (s.burned_calories || 0), 0);

  setText('#stepsValue', latest.steps || 0);
  setText('#caloriesValue', latest.calories || totalSessionCalories || 0);
  setText('#waterValue', latest.water_cups || 0);
  setText('#sleepMetric', `${latest.sleep_hours || 0} س`);
  setText('#heartMetric', latest.heart_rate || 0);
  setText('#weightMetric', `${latest.weight_kg || 0} كجم`);
  setText('#goalMetric', goalLabel(state.profile?.goal));
  setText('#completedSessionsMetric', state.workoutSessions.length || 0);
  setText('#activeMinutesMetric', `${totalSessionMinutes || 0} د`);
  els.welcomeText.textContent = `مرحبًا ${state.profile?.full_name || ''} — استمر على وتيرتك الصحية.`;

  renderRing('stepsRing', latest.steps || 0, 10000, ['#10b981', '#dbeafe']);
  renderRing('caloriesRing', latest.calories || totalSessionCalories || 0, 900, ['#2563eb', '#dbeafe']);
  renderRing('waterRing', latest.water_cups || 0, 8, ['#06b6d4', '#dbeafe']);
  renderRecommendations(latest, totalSessionMinutes);
  renderProgressCharts();
}

function renderRecommendations(latest, totalSessionMinutes = 0) {
  const cards = [];
  if ((latest.water_cups || 0) < 6) cards.push(['اشرب ماء أكثر', 'أضف كوبين ماء خلال الساعتين القادمتين.']);
  if ((latest.steps || 0) < 7000) cards.push(['تحرك قليلًا', 'امشِ 15 دقيقة للوصول إلى هدف اليوم.']);
  if (totalSessionMinutes < 20) cards.push(['جلسة تمرين سريعة', 'ابدأ أحد البرامج الجاهزة وأكمل 20 دقيقة على الأقل اليوم.']);
  if ((latest.sleep_hours || 0) < 7) cards.push(['حسّن النوم', 'حاول النوم مبكرًا الليلة لتحسين التعافي.']);
  if (!cards.length) cards.push(['أداء ممتاز', 'أكملت معظم أهدافك اليومية. استمر.']);
  els.recommendations.innerHTML = cards.map(([t, d]) => `<div class="recommendation-card"><strong>${t}</strong><span class="muted">${d}</span></div>`).join('');
}

function renderWorkouts() {
  if (!state.workouts.length) {
    els.workoutsList.innerHTML = `<div class="muted">لا توجد برامج بعد.</div>`;
    return;
  }

  els.workoutsList.innerHTML = state.workouts.map(w => `
    <article class="workout-card">
      <div class="workout-topline">
        <span class="badge ${badgeForIntensity(w.intensity)}">${labelIntensity(w.intensity)}</span>
        <span class="muted">${w.duration_minutes} دقيقة</span>
      </div>
      <h4>${w.name}</h4>
      <div class="workout-meta">${w.duration_minutes} دقيقة • ${labelIntensity(w.intensity)} • ${w.estimated_calories} سعرة</div>
      <div class="workout-actions">
        <button class="primary-btn workout-start-btn" data-workout-id="${w.id}">ابدأ الآن</button>
        <button class="ghost-btn workout-preview-btn" data-workout-id="${w.id}">معاينة</button>
      </div>
    </article>
  `).join('');

  qsa('.workout-start-btn').forEach(btn => btn.addEventListener('click', () => startWorkoutById(btn.dataset.workoutId)));
  qsa('.workout-preview-btn').forEach(btn => btn.addEventListener('click', () => previewWorkout(btn.dataset.workoutId)));
}

function renderWorkoutPlayer() {
  const workout = state.activeWorkout;
  const hasWorkout = !!workout;

  els.workoutPlayerEmpty.classList.toggle('hidden', hasWorkout);
  els.workoutPlayerActive.classList.toggle('hidden', !hasWorkout);

  if (!hasWorkout) {
    els.workoutSessionMsg.textContent = state.storageMode === 'local'
      ? 'سيتم حفظ جلسات التمرين محليًا حتى تنشئ جدول workout_sessions.'
      : 'اختر برنامجًا من الأسفل لبدء جلسة تفاعلية.';
    return;
  }

  const progress = Math.min(Math.round((state.elapsedSeconds / (workout.duration_minutes * 60)) * 100), 100);
  const remainingSeconds = Math.max(workout.duration_minutes * 60 - state.elapsedSeconds, 0);

  els.workoutPlayerTitle.textContent = workout.name;
  els.workoutPlayerMeta.textContent = `${workout.duration_minutes} دقيقة • ${labelIntensity(workout.intensity)} • ${workout.estimated_calories} سعرة متوقعة`;
  els.workoutTimer.textContent = formatTime(state.elapsedSeconds);
  els.workoutProgressFill.style.width = `${progress}%`;
  els.workoutProgressText.textContent = `المتبقي ${formatTime(remainingSeconds)} • التقدم ${progress}%`;
  els.workoutMode.textContent = state.storageMode === 'local' ? 'حفظ محلي مؤقت' : 'حفظ مباشر في قاعدة البيانات';
  els.workoutSessionMsg.textContent = state.timerRunning
    ? 'الجلسة نشطة الآن — يمكنك الإيقاف المؤقت أو الإكمال والحفظ.'
    : state.elapsedSeconds
      ? 'الجلسة متوقفة مؤقتًا — يمكنك المتابعة أو الإنهاء.'
      : 'ابدأ الجلسة لبدء المؤقت وتسجيل الأداء.';

  els.startWorkoutBtn.classList.toggle('hidden', state.timerRunning);
  els.pauseWorkoutBtn.classList.toggle('hidden', !state.timerRunning);
}

function renderWorkoutSessions() {
  if (!state.workoutSessions.length) {
    els.recentWorkoutSessions.innerHTML = `<div class="muted">لا توجد جلسات مسجلة بعد.</div>`;
    return;
  }

  els.recentWorkoutSessions.innerHTML = state.workoutSessions.slice(0, 6).map(session => `
    <article class="session-card">
      <div class="session-topline">
        <strong>${session.workout_name || 'جلسة تمرين'}</strong>
        <span class="badge ${session.status === 'completed' ? 'success' : 'info'}">${session.status === 'completed' ? 'مكتملة' : 'محفوظة'}</span>
      </div>
      <div class="muted">${session.completed_minutes || 0} دقيقة • ${session.burned_calories || 0} سعرة</div>
      <div class="muted">${formatDateTime(session.started_at || session.created_at)}</div>
    </article>
  `).join('');
}

function renderMeals() {
  const totals = state.meals.reduce((acc, m) => {
    acc.protein += m.protein_g || 0;
    acc.carbs += m.carbs_g || 0;
    acc.fat += m.fat_g || 0;
    return acc;
  }, { protein: 0, carbs: 0, fat: 0 });

  if (state.charts.macros) state.charts.macros.destroy();
  state.charts.macros = new Chart(qs('#macrosChart'), {
    type: 'doughnut',
    data: {
      labels: ['Protein', 'Carbs', 'Fat'],
      datasets: [{ data: [totals.protein, totals.carbs, totals.fat], backgroundColor: ['#10b981', '#2563eb', '#f59e0b'] }]
    },
    options: chartBase('المغذيات')
  });

  els.mealList.innerHTML = state.meals.map(m => `
    <article class="meal-card">
      <h4>${m.meal_name}</h4>
      <div class="workout-meta">P ${m.protein_g}g • C ${m.carbs_g}g • F ${m.fat_g}g</div>
    </article>
  `).join('') || `<div class="muted">لا توجد وجبات مسجلة.</div>`;
}

function renderProgressCharts() {
  const labels = state.dailyMetrics.map(r => r.entry_date?.slice(5));
  const steps = state.dailyMetrics.map(r => r.steps || 0);
  const calories = state.dailyMetrics.map(r => r.calories || 0);
  const sleep = state.dailyMetrics.map(r => r.sleep_hours || 0);
  const weight = state.dailyMetrics.map(r => r.weight_kg || 0);

  const sessionLabels = state.workoutSessions.slice().reverse().map((s, idx) => s.workout_name || `جلسة ${idx + 1}`);
  const sessionMinutes = state.workoutSessions.slice().reverse().map(s => s.completed_minutes || 0);

  if (state.charts.line) state.charts.line.destroy();
  state.charts.line = new Chart(qs('#progressLineChart'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'الخطوات', data: steps, borderColor: '#10b981', tension: .35 },
      { label: 'السعرات', data: calories, borderColor: '#2563eb', tension: .35 }
    ]}, options: chartBase('التقدم')
  });

  if (state.charts.bar) state.charts.bar.destroy();
  state.charts.bar = new Chart(qs('#progressBarChart'), {
    type: 'bar',
    data: { labels: sessionLabels.length ? sessionLabels : labels, datasets: [
      { label: sessionLabels.length ? 'مدة الجلسات' : 'النوم', data: sessionLabels.length ? sessionMinutes : sleep, backgroundColor: '#06b6d4' },
      { label: sessionLabels.length ? 'الوزن الحالي' : 'الوزن', data: sessionLabels.length ? Array(sessionLabels.length).fill(weight.at(-1) || 0) : weight, backgroundColor: '#f59e0b' }
    ]}, options: chartBase('التقدم')
  });
}

function renderAdminWorkouts() {
  if (state.profile?.role !== 'admin') return;
  els.adminWorkoutsList.innerHTML = state.workouts.map(w => `
    <div class="admin-item">
      <h4>${w.name}</h4>
      <div class="muted">${w.duration_minutes} دقيقة • ${labelIntensity(w.intensity)} • ${w.estimated_calories} سعرة</div>
    </div>
  `).join('');
}

function renderUsers(users) {
  if (state.profile?.role !== 'admin') return;
  els.adminUsersList.innerHTML = users.map(u => `
    <div class="user-item">
      <h4>${u.full_name || 'بدون اسم'}</h4>
      <div class="muted">${u.email}<br>${u.role} • ${u.subscription_plan} • ${u.subscription_status}</div>
    </div>
  `).join('');
}

function updatePlanUi() {
  els.planBadge.textContent = state.profile?.subscription_plan || 'free';
  els.planStatusText.textContent = state.profile?.subscription_status === 'active'
    ? 'اشتراكك فعّال ويمكنك الاستفادة من المزايا المدفوعة.'
    : 'اشتراكك غير مفعّل بعد. يمكنك الترقية في أي وقت.';
}

function switchView(view) {
  qsa('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  qsa('.app-view').forEach(v => {
    const isTarget = v.id === view;
    v.classList.toggle('active', isTarget);
    v.classList.toggle('hidden', !isTarget);
  });
  const label = { dashboard: 'لوحة اليوم', workouts: 'التمارين', nutrition: 'التغذية', progress: 'الإحصائيات', subscription: 'الاشتراك', admin: 'لوحة الإدارة' }[view] || 'لياقة';
  els.viewTitle.textContent = label;
}

function switchAuthTab(tab) {
  qsa('.tab').forEach(x => x.classList.toggle('active', x.dataset.authTab === tab));
  qs('#loginForm').classList.toggle('hidden', tab !== 'login');
  qs('#registerForm').classList.toggle('hidden', tab !== 'register');
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('liyaqa_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}

function previewWorkout(id) {
  const workout = state.workouts.find(w => String(w.id) === String(id));
  if (!workout) return;
  stopTimer();
  state.activeWorkout = workout;
  state.elapsedSeconds = 0;
  state.timerStartedAt = null;
  state.timerRunning = false;
  renderWorkoutPlayer();
  smoothToPlayer();
}

function startWorkoutById(id) {
  const workout = state.workouts.find(w => String(w.id) === String(id));
  if (!workout) return;
  stopTimer();
  state.activeWorkout = workout;
  state.elapsedSeconds = 0;
  state.timerStartedAt = Date.now();
  state.timerRunning = true;
  state.timerInterval = setInterval(updateTimer, 1000);
  renderWorkoutPlayer();
  smoothToPlayer();
}

function toggleWorkoutTimer() {
  if (!state.activeWorkout) return;
  if (state.timerRunning) {
    updateElapsedFromNow();
    stopTimer();
  } else {
    state.timerStartedAt = Date.now();
    state.timerRunning = true;
    state.timerInterval = setInterval(updateTimer, 1000);
  }
  renderWorkoutPlayer();
}

function updateTimer() {
  updateElapsedFromNow();
  renderWorkoutPlayer();
}

function updateElapsedFromNow() {
  if (!state.timerStartedAt) return;
  const delta = Math.max(0, Math.floor((Date.now() - state.timerStartedAt) / 1000));
  state.elapsedSeconds += delta;
  state.timerStartedAt = Date.now();

  const maxSeconds = (state.activeWorkout?.duration_minutes || 0) * 60;
  if (maxSeconds && state.elapsedSeconds >= maxSeconds) {
    state.elapsedSeconds = maxSeconds;
    completeWorkoutSession();
  }
}

function stopTimer() {
  state.timerRunning = false;
  state.timerStartedAt = null;
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

async function completeWorkoutSession() {
  if (!state.activeWorkout) return;
  if (state.timerRunning) updateElapsedFromNow();
  stopTimer();

  const workout = state.activeWorkout;
  const completedMinutes = Math.max(1, Math.round(state.elapsedSeconds / 60));
  const progressRatio = Math.min(state.elapsedSeconds / (workout.duration_minutes * 60 || 1), 1);
  const burnedCalories = Math.max(1, Math.round((workout.estimated_calories || 0) * progressRatio));
  const sessionRecord = {
    user_id: state.session.user.id,
    workout_id: workout.id,
    workout_name: workout.name,
    status: 'completed',
    completed_minutes: completedMinutes,
    burned_calories: burnedCalories,
    started_at: new Date(Date.now() - (state.elapsedSeconds * 1000)).toISOString(),
    ended_at: new Date().toISOString()
  };

  const saveResult = await persistWorkoutSession(sessionRecord);
  if (!saveResult.ok) {
    els.workoutSessionMsg.textContent = 'تم إكمال الجلسة لكن تعذر حفظها في قاعدة البيانات. تم حفظها محليًا.';
  } else {
    els.workoutSessionMsg.textContent = state.storageMode === 'local'
      ? 'تم حفظ الجلسة محليًا بنجاح.'
      : 'تم حفظ الجلسة في قاعدة البيانات بنجاح.';
  }

  await loadWorkoutSessions();
  await mergeSessionIntoDailyMetrics(burnedCalories, completedMinutes);
  state.activeWorkout = null;
  state.elapsedSeconds = 0;
  renderAll();
}

function cancelWorkoutSession() {
  stopTimer();
  state.activeWorkout = null;
  state.elapsedSeconds = 0;
  els.workoutSessionMsg.textContent = 'تم إلغاء الجلسة الحالية.';
  renderWorkoutPlayer();
}

async function persistWorkoutSession(sessionRecord) {
  const { error } = await supabaseClient.from('workout_sessions').insert(sessionRecord);
  if (!error) {
    state.storageMode = 'database';
    return { ok: true };
  }

  console.warn('Saving workout session locally because DB insert failed:', error.message || error);
  state.storageMode = 'local';
  const local = readLocalWorkoutSessions();
  local.unshift({ ...sessionRecord, created_at: new Date().toISOString() });
  localStorage.setItem(localWorkoutStorageKey(), JSON.stringify(local.slice(0, 20)));
  return { ok: false, error };
}

async function mergeSessionIntoDailyMetrics(extraCalories, extraMinutes) {
  const today = new Date().toISOString().slice(0, 10);
  const existing = state.dailyMetrics.find(x => x.entry_date === today);
  const record = {
    user_id: state.session.user.id,
    entry_date: today,
    steps: existing?.steps || 0,
    calories: (existing?.calories || 0) + extraCalories,
    water_cups: existing?.water_cups || 0,
    sleep_hours: existing?.sleep_hours || 0,
    weight_kg: existing?.weight_kg || 0,
    heart_rate: existing?.heart_rate || 0,
    active_minutes: (existing?.active_minutes || 0) + extraMinutes
  };

  const { error } = await supabaseClient.from('daily_metrics').upsert(record, { onConflict: 'user_id,entry_date' });
  if (!error) {
    await loadDailyMetrics();
  }
}

function renderRing(canvasId, value, total, colors) {
  const key = `ring_${canvasId}`;
  if (state.charts[key]) state.charts[key].destroy();
  state.charts[key] = new Chart(qs(`#${canvasId}`), {
    type: 'doughnut',
    data: { datasets: [{ data: [Math.min(value, total), Math.max(total - value, 0)], backgroundColor: colors, borderWidth: 0 }] },
    options: { cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
  });
}

function chartBase() {
  return {
    responsive: true,
    plugins: { legend: { labels: { color: getComputedStyle(document.body).getPropertyValue('--text') } } },
    scales: {
      x: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--muted') }, grid: { color: 'rgba(148,163,184,.16)' } },
      y: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--muted') }, grid: { color: 'rgba(148,163,184,.16)' } }
    }
  };
}

function localWorkoutStorageKey() {
  return `liyaqa_workout_sessions_${state.session?.user?.id || 'guest'}`;
}

function readLocalWorkoutSessions() {
  try {
    return JSON.parse(localStorage.getItem(localWorkoutStorageKey()) || '[]');
  } catch {
    return [];
  }
}

function smoothToPlayer() {
  els.workoutPlayer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function badgeForIntensity(v) {
  return ({ low: 'soft', medium: 'info', high: 'warning' }[v] || 'info');
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(part => String(part).padStart(2, '0')).join(':');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function goalLabel(v) {
  return ({ weight_loss: 'خفض الوزن', fitness: 'لياقة عامة', muscle: 'بناء عضل', wellness: 'عافية' }[v] || '—');
}

function labelIntensity(v) {
  return ({ low: 'منخفضة', medium: 'متوسطة', high: 'عالية' }[v] || v);
}

function qs(s) { return document.querySelector(s); }
function qsa(s) { return [...document.querySelectorAll(s)]; }
function setText(sel, val) { const el = qs(sel); if (el) el.textContent = val; }
function num(sel) { return Number(qs(sel).value || 0); }
