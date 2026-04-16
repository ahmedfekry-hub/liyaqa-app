const cfg = window.LIYAQA_CONFIG || {};
const supabaseClient = window.supabase?.createClient?.(cfg.supabaseUrl, cfg.supabaseAnonKey);

const state = {
  session: null,
  profile: null,
  dailyMetrics: [],
  workouts: [],
  meals: [],
  workoutSessions: [],
  charts: {},
  workoutEngine: {
    active: false,
    paused: false,
    startedAt: null,
    elapsedSeconds: 0,
    intervalId: null,
    selectedWorkout: null,
    message: '',
    currentFlow: [],
    currentPhaseIndex: 0,
    currentPhaseRemaining: 0,
    flowTotalSeconds: 0,
    flowElapsedSeconds: 0,
    currentPhase: null,
    nextPhase: null,
    soundEnabled: true
  }
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
  workoutStatusMsg: qs('#workoutStatusMsg'),
  sessionList: qs('#sessionList') || qs('#recentSessionsList'),
  sessionEmpty: qs('#sessionEmpty') || qs('#recentSessionsEmpty'),
  mealList: qs('#mealList'),
  adminWorkoutsList: qs('#adminWorkoutsList'),
  adminUsersList: qs('#adminUsersList'),
  subscriptionMsg: qs('#subscriptionMsg'),

  // workout interactive area
  activeWorkoutName: qs('#activeWorkoutName'),
  activeWorkoutMeta: qs('#activeWorkoutMeta'),
  activeWorkoutTimer: qs('#activeWorkoutTimer') || qs('#sessionTimer'),
  activeWorkoutProgress: qs('#activeWorkoutProgress') || qs('#sessionProgress'),
  activeWorkoutProgressText: qs('#activeWorkoutProgressText') || qs('#sessionProgressText'),
  startWorkoutBtn: qs('#startWorkoutBtn') || qs('#sessionStartBtn'),
  pauseWorkoutBtn: qs('#pauseWorkoutBtn') || qs('#sessionPauseBtn'),
  completeWorkoutBtn: qs('#completeWorkoutBtn') || qs('#sessionCompleteBtn'),
  cancelWorkoutBtn: qs('#cancelWorkoutBtn') || qs('#sessionCancelBtn'),
  workoutPanelHint: qs('#workoutPanelHint') || qs('#sessionHint'),
  workoutModeBadge: qs('#workoutMode'),
  workoutPhaseBadge: qs('#workoutPhaseBadge'),
  workoutPhaseName: qs('#workoutPhaseName'),
  workoutPhaseMeta: qs('#workoutPhaseMeta'),
  workoutNextLabel: qs('#workoutNextLabel'),
  workoutPlanSteps: qs('#workoutPlanSteps'),

  // dashboard quick stats
  sessionsCompletedMetric: qs('#sessionsCompletedMetric'),
  activeMinutesMetric: qs('#activeMinutesMetric')
};

init();

async function init() {
  bindUi();

  if (!supabaseClient || !cfg.supabaseUrl || String(cfg.supabaseUrl).includes('YOUR_')) {
    if (els.authMsg) {
      els.authMsg.textContent = 'ضع مفاتيح Supabase داخل config.js أولاً ثم أعد تحميل الصفحة.';
    }
    renderWorkoutPanel();
    return;
  }

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

  on('#themeToggle', 'click', toggleTheme);
  on('#loginForm', 'submit', onLogin);
  on('#registerForm', 'submit', onRegister);
  on('#dailyMetricsForm', 'submit', saveDailyMetrics);
  on('#mealForm', 'submit', saveMeal);
  on('#workoutAdminForm', 'submit', saveWorkout);
  on('#logoutBtn', 'click', async () => { await supabaseClient?.auth?.signOut?.(); });
  on('#refreshWorkoutsBtn', 'click', async () => { await loadWorkouts(); renderWorkouts(); });
  qsa('.subscription-btn').forEach(btn => btn.addEventListener('click', onSubscribe));

  if (els.startWorkoutBtn) els.startWorkoutBtn.addEventListener('click', startSelectedWorkout);
  if (els.pauseWorkoutBtn) els.pauseWorkoutBtn.addEventListener('click', togglePauseWorkout);
  if (els.completeWorkoutBtn) els.completeWorkoutBtn.addEventListener('click', completeWorkoutSession);
  if (els.cancelWorkoutBtn) els.cancelWorkoutBtn.addEventListener('click', cancelWorkoutSession);

  const savedTheme = localStorage.getItem('liyaqa_theme') || 'light';
  document.body.classList.toggle('dark', savedTheme === 'dark');
  renderWorkoutPanel();
}

async function applyAuthState() {
  const loggedIn = !!state.session?.user;
  toggle(els.authView, 'hidden', loggedIn);
  toggle(els.appViews, 'hidden', !loggedIn);
  toggle(els.logoutBtn, 'hidden', !loggedIn);

  if (!loggedIn) {
    resetWorkoutEngine();
    switchView('dashboard');
    return;
  }

  await loadProfile();
  await Promise.all([
    loadDailyMetrics(),
    loadMeals(),
    loadWorkouts(),
    loadWorkoutSessions()
  ]);
  await maybeLoadAdminData();
  renderAll();
}

async function onLogin(e) {
  e.preventDefault();
  const email = val('#loginEmail').trim();
  const password = val('#loginPassword');
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (els.authMsg) els.authMsg.textContent = error ? error.message : 'تم تسجيل الدخول.';
}

async function onRegister(e) {
  e.preventDefault();
  const payload = {
    email: val('#registerEmail').trim(),
    password: val('#registerPassword'),
    options: {
      data: {
        full_name: val('#registerName').trim(),
        goal: val('#registerGoal')
      }
    }
  };

  const { error } = await supabaseClient.auth.signUp(payload);
  if (els.authMsg) {
    els.authMsg.textContent = error
      ? error.message
      : 'تم إنشاء الحساب. افحص البريد لتأكيده إذا كان التفعيل مطلوبًا.';
  }
}

async function loadProfile() {
  const user = state.session?.user;
  if (!user) return;

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
    return;
  }

  state.profile = data || null;
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
    if (els.workoutsList) {
      els.workoutsList.innerHTML = '<div class="muted">تعذر تحميل البرامج التدريبية.</div>';
    }
    return;
  }

  state.workouts = data || [];
}

async function loadWorkoutSessions() {
  if (!state.session?.user) {
    state.workoutSessions = [];
    return;
  }

  const local = readLocalSessions();
  let remote = [];

  const { data, error } = await supabaseClient
    .from('workout_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(12);

  if (!error && Array.isArray(data)) remote = data;
  state.workoutSessions = mergeSessions(remote, local);
}

async function maybeLoadAdminData() {
  const isAdmin = state.profile?.role === 'admin';
  qsa('.admin-only').forEach(el => toggle(el, 'hidden', !isAdmin));
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

  const { error } = await supabaseClient
    .from('daily_metrics')
    .upsert(record, { onConflict: 'user_id,entry_date' });

  if (!error) {
    await loadDailyMetrics();
    renderAll();
  }
}

async function saveMeal(e) {
  e.preventDefault();
  const record = {
    user_id: state.session.user.id,
    meal_name: val('#mealName').trim(),
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
    name: val('#adminWorkoutName').trim(),
    duration_minutes: num('#adminWorkoutDuration'),
    intensity: val('#adminWorkoutIntensity'),
    estimated_calories: num('#adminWorkoutCalories'),
    is_active: true,
    created_by: state.session.user.id
  };

  const { error } = await supabaseClient.from('workout_programs').insert(record);
  if (!error) {
    e.target.reset();
    await loadWorkouts();
    renderWorkouts();
    renderAdminWorkouts();
  }
}

async function onSubscribe(e) {
  const plan = e.currentTarget.dataset.plan;
  const link = cfg.stripeLinks?.[plan];
  if (!link || String(link).includes('test_')) {
    if (els.subscriptionMsg) {
      els.subscriptionMsg.textContent = 'أضف رابط Stripe الحقيقي لهذا الاشتراك داخل config.js.';
    }
    return;
  }

  await supabaseClient.from('subscription_events').insert({
    user_id: state.session.user.id,
    event_type: 'checkout_started',
    payload: { plan, source: 'client_redirect' }
  });

  window.location.href = `${link}?prefilled_email=${encodeURIComponent(state.session.user.email)}`;
}

function renderAll() {
  renderDashboard();
  renderMeals();
  renderWorkouts();
  renderWorkoutPanel();
  renderWorkoutSessions();
  renderAdminWorkouts();
  updatePlanUi();
}

function renderDashboard() {
  const latest = state.dailyMetrics.at(-1) || {};
  setText('#stepsValue', latest.steps || 0);
  setText('#caloriesValue', latest.calories || 0);
  setText('#waterValue', latest.water_cups || 0);
  setText('#sleepMetric', `${latest.sleep_hours || 0} س`);
  setText('#heartMetric', latest.heart_rate || 0);
  setText('#weightMetric', `${latest.weight_kg || 0} كجم`);
  setText('#goalMetric', goalLabel(state.profile?.goal));

  const completedSessions = state.workoutSessions.filter(s => s.status === 'completed').length;
  const activeMinutes = state.workoutSessions
    .filter(s => s.status === 'completed')
    .reduce((sum, s) => sum + Number(s.completed_minutes || 0), 0);

  if (els.sessionsCompletedMetric) els.sessionsCompletedMetric.textContent = completedSessions;
  if (els.activeMinutesMetric) els.activeMinutesMetric.textContent = `${activeMinutes} د`;

  if (els.welcomeText) {
    els.welcomeText.textContent = `مرحبًا ${state.profile?.full_name || ''} — استمر على وتيرتك الصحية.`;
  }

  renderRing('stepsRing', latest.steps || 0, 10000, ['#10b981', '#dbeafe']);
  renderRing('caloriesRing', latest.calories || 0, 900, ['#2563eb', '#dbeafe']);
  renderRing('waterRing', latest.water_cups || 0, 8, ['#06b6d4', '#dbeafe']);
  renderRecommendations(latest, completedSessions);
  renderProgressCharts();
}

function renderRecommendations(latest, completedSessions) {
  if (!els.recommendations) return;
  const cards = [];
  if ((latest.water_cups || 0) < 6) cards.push(['اشرب ماء أكثر', 'أضف كوبين ماء خلال الساعتين القادمتين.']);
  if ((latest.steps || 0) < 7000) cards.push(['تحرّك قليلًا', 'امشِ 15 دقيقة للوصول إلى هدف اليوم.']);
  if ((latest.sleep_hours || 0) < 7) cards.push(['حسّن النوم', 'حاول النوم مبكرًا الليلة لتحسين التعافي.']);
  if (completedSessions === 0) cards.push(['جلسة تمرين سريعة', 'ابدأ أحد البرامج الجاهزة وأكمل 20 دقيقة على الأقل اليوم.']);
  if (!cards.length) cards.push(['أداء ممتاز', 'أكملت معظم أهدافك اليومية. استمر.']);

  els.recommendations.innerHTML = cards.map(([t, d]) => `
    <div class="recommendation-card">
      <strong>${t}</strong>
      <span class="muted">${d}</span>
    </div>
  `).join('');
}

function renderWorkouts() {
  if (!els.workoutsList) return;

  if (!state.workouts.length) {
    els.workoutsList.innerHTML = '<div class="muted">لا توجد برامج بعد.</div>';
    return;
  }

  els.workoutsList.innerHTML = state.workouts.map(w => `
    <article class="workout-card">
      <div class="workout-meta" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px">
        <span>${w.duration_minutes} دقيقة</span>
        <span class="badge info">${labelIntensity(w.intensity)}</span>
      </div>
      <h4>${w.name}</h4>
      <div class="workout-meta">${w.duration_minutes} دقيقة • ${labelIntensity(w.intensity)} • ${w.estimated_calories} سعرة</div>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
        <button class="ghost-btn workout-preview-btn" data-workout-id="${w.id}">معاينة</button>
        <button class="primary-btn workout-start-btn" data-workout-id="${w.id}">ابدأ الآن</button>
      </div>
    </article>
  `).join('');

  qsa('.workout-start-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const workout = state.workouts.find(w => String(w.id) === String(btn.dataset.workoutId));
      prepareWorkoutSession(workout);
    });
  });

  qsa('.workout-preview-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const workout = state.workouts.find(w => String(w.id) === String(btn.dataset.workoutId));
      previewWorkout(workout);
    });
  });
}

function previewWorkout(workout) {
  if (!workout) return;
  state.workoutEngine.message = `البرنامج الحالي: ${workout.name}`;
  setActiveWorkout(workout, false);
  renderWorkoutPanel();
}

function setActiveWorkout(workout, activate) {
  state.workoutEngine.selectedWorkout = workout || null;
  if (activate) {
    state.workoutEngine.active = true;
    state.workoutEngine.paused = false;
    state.workoutEngine.startedAt = new Date().toISOString();
    state.workoutEngine.elapsedSeconds = 0;
  }
}

function prepareWorkoutSession(workout) {
  if (!workout) return;
  stopWorkoutTimer();
  setActiveWorkout(workout, false);
  initializeWorkoutFlow(workout);
  state.workoutEngine.message = 'البرنامج جاهز — اضغط ابدأ لتشغيل الإحماء والعدّ التنازلي.';
  renderWorkoutPanel();
}

function startSelectedWorkout() {
  const workout = state.workoutEngine.selectedWorkout || state.workouts[0] || null;
  if (!workout) {
    state.workoutEngine.message = 'اختر برنامجًا من الأسفل لبدء جلسة تفاعلية.';
    renderWorkoutPanel();
    return;
  }

  if (!state.workoutEngine.currentFlow.length) {
    initializeWorkoutFlow(workout);
  }

  if (!state.workoutEngine.active) {
    setActiveWorkout(workout, true);
    state.workoutEngine.flowElapsedSeconds = 0;
    state.workoutEngine.currentPhaseIndex = 0;
    startPhaseAtIndex(0);
    state.workoutEngine.message = 'بدأت الجلسة — اتبع المرحلة الحالية حتى تسمع التنبيه للانتقال.';
  } else if (state.workoutEngine.paused) {
    state.workoutEngine.paused = false;
    state.workoutEngine.message = 'تمت متابعة الجلسة.';
  }

  stopWorkoutTimer();
  state.workoutEngine.intervalId = setInterval(() => {
    if (state.workoutEngine.paused || !state.workoutEngine.active) return;

    state.workoutEngine.elapsedSeconds += 1;
    state.workoutEngine.flowElapsedSeconds += 1;
    state.workoutEngine.currentPhaseRemaining = Math.max(0, state.workoutEngine.currentPhaseRemaining - 1);

    if (state.workoutEngine.currentPhaseRemaining <= 0) {
      playPhaseBeep();
      nextWorkoutPhase();
      return;
    }

    renderWorkoutPanel();
  }, 1000);

  renderWorkoutPanel();
}

function togglePauseWorkout() {
  if (!state.workoutEngine.active) return;
  state.workoutEngine.paused = !state.workoutEngine.paused;
  state.workoutEngine.message = state.workoutEngine.paused
    ? 'تم إيقاف الجلسة مؤقتًا.'
    : 'تمت متابعة الجلسة.';
  renderWorkoutPanel();
}

async function completeWorkoutSession() {
  if (!state.workoutEngine.active || !state.workoutEngine.selectedWorkout) return;

  stopWorkoutTimer();
  const w = state.workoutEngine.selectedWorkout;
  const minutes = Math.max(1, Math.round(state.workoutEngine.elapsedSeconds / 60));
  const estimatedBurn = calcBurnedCalories(w, minutes);

  const record = {
    id: cryptoRandomId(),
    user_id: state.session?.user?.id,
    workout_id: w.id,
    workout_name: w.name,
    status: 'completed',
    completed_minutes: minutes,
    burned_calories: estimatedBurn,
    started_at: state.workoutEngine.startedAt || new Date(Date.now() - state.workoutEngine.elapsedSeconds * 1000).toISOString(),
    ended_at: new Date().toISOString()
  };

  const saveResult = await persistWorkoutSession(record);

  state.workoutSessions = mergeSessions([saveResult.record], state.workoutSessions);
  state.workoutEngine.message = saveResult.message;
  resetWorkoutEngine(false);

  await loadWorkoutSessions();
  renderWorkoutSessions();
  renderAll();
}

function cancelWorkoutSession() {
  stopWorkoutTimer();
  const hadActive = state.workoutEngine.active;
  resetWorkoutEngine(false);
  state.workoutEngine.message = hadActive ? 'تم إلغاء الجلسة الحالية.' : 'لا توجد جلسة نشطة للإلغاء.';
  renderWorkoutPanel();
}

async function persistWorkoutSession(record) {
  let message = 'تم حفظ الجلسة محليًا.';
  let savedRecord = { ...record, source: 'local' };

  try {
    const { data, error } = await supabaseClient
      .from('workout_sessions')
      .insert(record)
      .select('*')
      .single();

    if (error) throw error;
    savedRecord = data || record;
    message = 'تم حفظ الجلسة في قاعدة البيانات بنجاح.';
  } catch (error) {
    console.error('Workout session save error:', error);
    writeLocalSession(savedRecord);
    message = 'تعذر الحفظ في قاعدة البيانات. تم حفظ الجلسة محليًا.';
  }

  return { record: savedRecord, message };
}

function renderWorkoutPanel() {
  const engine = state.workoutEngine;
  const workout = engine.selectedWorkout;
  const phase = engine.currentPhase;
  const nextPhase = engine.nextPhase;

  if (els.activeWorkoutName) {
    els.activeWorkoutName.textContent = workout ? workout.name : 'اختر برنامجًا لبدء الجلسة';
  }

  if (els.activeWorkoutMeta) {
    els.activeWorkoutMeta.textContent = workout
      ? `${workout.duration_minutes} دقيقة • ${labelIntensity(workout.intensity)} • ${workout.estimated_calories} سعرة متوقعة`
      : 'من هنا يمكنك تشغيل التمرين الاحترافي بمراحل: إحماء، أداء، راحة، تبريد.';
  }

  if (els.activeWorkoutTimer) {
    els.activeWorkoutTimer.textContent = formatElapsed(engine.elapsedSeconds);
  }

  if (els.workoutModeBadge) {
    const label = !workout ? 'جاهز' : engine.paused ? 'متوقف' : engine.active ? 'نشط' : 'مُهيأ';
    els.workoutModeBadge.textContent = label;
    els.workoutModeBadge.className = `badge ${engine.paused ? 'warning' : engine.active ? 'success' : 'info'}`;
  }

  if (els.workoutPhaseBadge) {
    els.workoutPhaseBadge.textContent = phase ? phaseTypeLabel(phase.type) : 'قبل البدء';
    els.workoutPhaseBadge.className = `badge ${phaseBadgeClass(phase?.type)}`;
  }

  if (els.workoutPhaseName) {
    els.workoutPhaseName.textContent = phase ? phase.label : 'اختر برنامجًا لبدء الجلسة';
  }

  if (els.workoutPhaseMeta) {
    const remain = phase ? formatCompact(engine.currentPhaseRemaining) : '00:00';
    els.workoutPhaseMeta.textContent = phase
      ? `المرحلة الحالية • المتبقي ${remain} • إجمالي الخطة ${engine.currentFlow.length} مراحل`
      : 'سيظهر هنا اسم المرحلة الحالية والعدّ التنازلي الخاص بها.';
  }

  if (els.workoutNextLabel) {
    els.workoutNextLabel.textContent = nextPhase
      ? `الخطوة التالية: ${phaseTypeLabel(nextPhase.type)} — ${nextPhase.label}`
      : (workout ? 'هذه آخر مرحلة — عند الانتهاء سيتم حفظ الجلسة.' : 'اختر برنامجًا من اليسار لعرض الخطة.');
  }

  if (els.workoutPlanSteps) {
    const steps = engine.currentFlow || [];
    els.workoutPlanSteps.innerHTML = steps.map((item, idx) => {
      const isCurrent = idx === engine.currentPhaseIndex && engine.active;
      const isDone = idx < engine.currentPhaseIndex;
      return `<div class="plan-step ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}">
        <span class="plan-step-tag">${idx + 1}</span>
        <div>
          <strong>${phaseTypeLabel(item.type)}</strong>
          <div class="muted">${item.label} • ${formatCompact(item.duration)}</div>
        </div>
      </div>`;
    }).join('');
  }

  const percent = calcWorkoutProgress();
  if (els.activeWorkoutProgress) {
    els.activeWorkoutProgress.style.width = `${percent}%`;
  }
  if (els.activeWorkoutProgressText) {
    const remaining = workout ? Math.max(engine.flowTotalSeconds - engine.flowElapsedSeconds, 0) : 0;
    els.activeWorkoutProgressText.textContent = workout
      ? `المتبقي ${formatElapsed(remaining)} • التقدم %${percent}`
      : 'اختر برنامجًا من الأسفل لبدء جلسة تفاعلية.';
  }

  if (els.startWorkoutBtn) {
    els.startWorkoutBtn.textContent = engine.active ? (engine.paused ? 'متابعة' : 'قيد التشغيل') : 'ابدأ الجلسة';
    els.startWorkoutBtn.disabled = !workout && !state.workouts.length;
  }

  if (els.pauseWorkoutBtn) {
    els.pauseWorkoutBtn.disabled = !engine.active;
    els.pauseWorkoutBtn.textContent = engine.paused ? 'متابعة' : 'إيقاف مؤقت';
  }

  if (els.completeWorkoutBtn) {
    els.completeWorkoutBtn.disabled = !engine.active;
  }

  if (els.cancelWorkoutBtn) {
    els.cancelWorkoutBtn.disabled = !engine.active && !workout;
  }

  const msg = engine.message || 'اختر برنامجًا لبدء الجلسة.';
  if (els.workoutStatusMsg) els.workoutStatusMsg.textContent = msg;
  if (els.workoutPanelHint) els.workoutPanelHint.textContent = msg;
}

function renderWorkoutSessions() {
  if (!els.sessionList) return;

  const sessions = state.workoutSessions.slice(0, 6);
  toggle(els.sessionEmpty, 'hidden', sessions.length > 0);

  if (!sessions.length) {
    els.sessionList.innerHTML = '';
    return;
  }

  els.sessionList.innerHTML = sessions.map(s => `
    <article class="meal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <span class="badge success">${s.status === 'completed' ? 'مكتملة' : s.status}</span>
        <strong>${s.workout_name || 'جلسة تمرين'}</strong>
      </div>
      <div class="workout-meta">${s.completed_minutes || 0} دقيقة • ${s.burned_calories || 0} سعرة</div>
      <div class="workout-meta">${formatDateTime(s.ended_at || s.started_at)}</div>
    </article>
  `).join('');
}

function renderMeals() {
  const totals = state.meals.reduce((acc, m) => {
    acc.protein += Number(m.protein_g || 0);
    acc.carbs += Number(m.carbs_g || 0);
    acc.fat += Number(m.fat_g || 0);
    return acc;
  }, { protein: 0, carbs: 0, fat: 0 });

  if (qs('#macrosChart')) {
    if (state.charts.macros) state.charts.macros.destroy();
    state.charts.macros = new Chart(qs('#macrosChart'), {
      type: 'doughnut',
      data: {
        labels: ['Protein', 'Carbs', 'Fat'],
        datasets: [{ data: [totals.protein, totals.carbs, totals.fat], backgroundColor: ['#10b981', '#2563eb', '#f59e0b'] }]
      },
      options: chartBase('المغذيات')
    });
  }

  if (!els.mealList) return;
  els.mealList.innerHTML = state.meals.map(m => `
    <article class="meal-card">
      <h4>${m.meal_name}</h4>
      <div class="workout-meta">P ${m.protein_g}g • C ${m.carbs_g}g • F ${m.fat_g}g</div>
    </article>
  `).join('') || '<div class="muted">لا توجد وجبات مسجلة.</div>';
}

function renderProgressCharts() {
  renderDailyMetricsCharts();
  renderSessionCharts();
}

function renderDailyMetricsCharts() {
  const labels = state.dailyMetrics.map(r => (r.entry_date || '').slice(5));
  const steps = state.dailyMetrics.map(r => Number(r.steps || 0));
  const calories = state.dailyMetrics.map(r => Number(r.calories || 0));
  const sleep = state.dailyMetrics.map(r => Number(r.sleep_hours || 0));
  const weight = state.dailyMetrics.map(r => Number(r.weight_kg || 0));

  if (qs('#progressLineChart')) {
    if (state.charts.line) state.charts.line.destroy();
    state.charts.line = new Chart(qs('#progressLineChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'الخطوات', data: steps, borderColor: '#10b981', tension: 0.35 },
          { label: 'السعرات', data: calories, borderColor: '#2563eb', tension: 0.35 }
        ]
      },
      options: chartBase('اتجاه الخطوات والسعرات')
    });
  }

  if (qs('#progressBarChart')) {
    if (state.charts.bar) state.charts.bar.destroy();
    state.charts.bar = new Chart(qs('#progressBarChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'مدة الجلسات', data: sleep, backgroundColor: '#06b6d4' },
          { label: 'الوزن الحالي', data: weight, backgroundColor: '#f59e0b' }
        ]
      },
      options: chartBase('النوم والوزن')
    });
  }
}

function renderSessionCharts() {
  const completed = state.workoutSessions.filter(s => s.status === 'completed');
  if (!completed.length) return;

  const labels = completed.map(s => s.workout_name || 'جلسة');
  const minutes = completed.map(s => Number(s.completed_minutes || 0));
  const calories = completed.map(s => Number(s.burned_calories || 0));

  if (qs('#sessionMinutesChart')) {
    if (state.charts.sessionMinutes) state.charts.sessionMinutes.destroy();
    state.charts.sessionMinutes = new Chart(qs('#sessionMinutesChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'مدة الجلسات', data: minutes, backgroundColor: '#06b6d4' },
          { label: 'الوزن الحالي', data: new Array(minutes.length).fill(Number(state.dailyMetrics.at(-1)?.weight_kg || 0)), backgroundColor: '#f59e0b' }
        ]
      },
      options: chartBase('النوم والوزن')
    });
  }

  if (qs('#sessionCaloriesChart')) {
    if (state.charts.sessionCalories) state.charts.sessionCalories.destroy();
    state.charts.sessionCalories = new Chart(qs('#sessionCaloriesChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'الخطوات', data: new Array(calories.length).fill(Number(state.dailyMetrics.at(-1)?.steps || 0)), borderColor: '#10b981', tension: 0.35 },
          { label: 'السعرات', data: calories, borderColor: '#2563eb', tension: 0.35 }
        ]
      },
      options: chartBase('اتجاه الخطوات والسعرات')
    });
  }
}

function renderAdminWorkouts() {
  if (state.profile?.role !== 'admin' || !els.adminWorkoutsList) return;
  els.adminWorkoutsList.innerHTML = state.workouts.map(w => `
    <div class="admin-item">
      <h4>${w.name}</h4>
      <div class="muted">${w.duration_minutes} دقيقة • ${labelIntensity(w.intensity)}</div>
    </div>
  `).join('');
}

function renderUsers(users) {
  if (state.profile?.role !== 'admin' || !els.adminUsersList) return;
  els.adminUsersList.innerHTML = users.map(u => `
    <div class="user-item">
      <h4>${u.full_name || 'بدون اسم'}</h4>
      <div class="muted">${u.email}<br>${u.role} • ${u.subscription_plan} • ${u.subscription_status}</div>
    </div>
  `).join('');
}

function updatePlanUi() {
  if (els.planBadge) els.planBadge.textContent = state.profile?.subscription_plan || 'free';
  if (els.planStatusText) {
    els.planStatusText.textContent = state.profile?.subscription_status === 'active'
      ? 'اشتراكك فعّال ويمكنك الاستفادة من المزايا المدفوعة.'
      : 'اشتراكك غير مفعّل بعد. يمكنك الترقية في أي وقت.';
  }
}

function switchView(view) {
  qsa('.nav-link').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  qsa('.app-view').forEach(v => {
    const active = v.id === view;
    v.classList.toggle('hidden', !active);
    v.classList.toggle('active', active);
  });
  const label = {
    dashboard: 'لوحة اليوم',
    workouts: 'التمارين',
    nutrition: 'التغذية',
    progress: 'الإحصائيات',
    subscription: 'الاشتراك',
    admin: 'لوحة الإدارة'
  }[view] || 'لياقة';
  if (els.viewTitle) els.viewTitle.textContent = label;
}

function switchAuthTab(tab) {
  qsa('.tab').forEach(x => x.classList.toggle('active', x.dataset.authTab === tab));
  toggle(qs('#loginForm'), 'hidden', tab !== 'login');
  toggle(qs('#registerForm'), 'hidden', tab !== 'register');
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('liyaqa_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  renderAll();
}

function renderRing(canvasId, value, total, colors) {
  const canvas = qs(`#${canvasId}`);
  if (!canvas || !window.Chart) return;
  const key = `ring_${canvasId}`;
  if (state.charts[key]) state.charts[key].destroy();
  state.charts[key] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [Math.min(value, total), Math.max(total - value, 0)],
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      cutout: '75%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      }
    }
  });
}

function chartBase() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: cssVar('--text') || '#0f172a' }
      }
    },
    scales: {
      x: {
        ticks: { color: cssVar('--muted') || '#64748b' },
        grid: { color: 'rgba(148,163,184,.16)' }
      },
      y: {
        ticks: { color: cssVar('--muted') || '#64748b' },
        grid: { color: 'rgba(148,163,184,.16)' }
      }
    }
  };
}


function createWorkoutFlow(workout) {
  const mins = Math.max(Number(workout?.duration_minutes || 20), 5);
  const intensity = workout?.intensity || 'medium';

  if ((workout?.name || '').includes('مشي')) {
    return [
      { type: 'warmup', label: 'إحماء ومشي خفيف', duration: 60 },
      { type: 'exercise', label: 'مشي سريع', duration: Math.max(180, mins * 60 - 120) },
      { type: 'cooldown', label: 'تهدئة وتنفس', duration: 60 }
    ];
  }

  const presets = {
    low: [
      ['warmup', 'إحماء ديناميكي', 45],
      ['exercise', 'حركة أساسية', 90],
      ['rest', 'راحة قصيرة', 20],
      ['exercise', 'تنشيط كامل للجسم', 90],
      ['cooldown', 'تمدد خفيف', 45]
    ],
    medium: [
      ['warmup', 'إحماء ديناميكي', 45],
      ['exercise', 'Jumping Jacks', 40],
      ['rest', 'راحة', 20],
      ['exercise', 'Squats', 40],
      ['rest', 'راحة', 20],
      ['exercise', 'High Knees', 40],
      ['rest', 'راحة', 20],
      ['exercise', 'Push-ups', 40],
      ['cooldown', 'تبريد وتمدد', 45]
    ],
    high: [
      ['warmup', 'إحماء سريع', 45],
      ['exercise', 'Burpees', 45],
      ['rest', 'راحة', 15],
      ['exercise', 'Mountain Climbers', 45],
      ['rest', 'راحة', 15],
      ['exercise', 'Jump Squats', 45],
      ['rest', 'راحة', 15],
      ['exercise', 'Push-ups', 45],
      ['cooldown', 'تبريد عميق', 60]
    ]
  }[intensity] || [];

  let flow = presets.map(([type, label, duration]) => ({ type, label, duration }));
  const targetSeconds = mins * 60;
  const current = flow.reduce((s, p) => s + p.duration, 0);
  const scale = current ? targetSeconds / current : 1;
  flow = flow.map((p, idx) => ({
    ...p,
    duration: idx === flow.length - 1 ? Math.max(20, Math.round(p.duration * scale)) : Math.max(15, Math.round(p.duration * scale))
  }));
  return flow;
}

function initializeWorkoutFlow(workout) {
  const flow = createWorkoutFlow(workout);
  state.workoutEngine.currentFlow = flow;
  state.workoutEngine.currentPhaseIndex = 0;
  state.workoutEngine.currentPhase = flow[0] || null;
  state.workoutEngine.nextPhase = flow[1] || null;
  state.workoutEngine.currentPhaseRemaining = flow[0]?.duration || 0;
  state.workoutEngine.flowTotalSeconds = flow.reduce((sum, item) => sum + Number(item.duration || 0), 0);
  state.workoutEngine.flowElapsedSeconds = 0;
}

function startPhaseAtIndex(index) {
  const flow = state.workoutEngine.currentFlow;
  const phase = flow[index];
  if (!phase) {
    completeWorkoutSession();
    return;
  }
  state.workoutEngine.currentPhaseIndex = index;
  state.workoutEngine.currentPhase = phase;
  state.workoutEngine.nextPhase = flow[index + 1] || null;
  state.workoutEngine.currentPhaseRemaining = Number(phase.duration || 0);
  state.workoutEngine.message = `${phaseTypeLabel(phase.type)} — ${phase.label}`;
  pulseVibration();
  renderWorkoutPanel();
}

function nextWorkoutPhase() {
  const nextIndex = state.workoutEngine.currentPhaseIndex + 1;
  if (nextIndex >= state.workoutEngine.currentFlow.length) {
    completeWorkoutSession();
    return;
  }
  startPhaseAtIndex(nextIndex);
}

function phaseTypeLabel(type) {
  return ({
    warmup: 'إحماء',
    exercise: 'تمرين',
    rest: 'راحة',
    cooldown: 'تبريد'
  }[type] || 'مرحلة');
}

function phaseBadgeClass(type) {
  return ({
    warmup: 'warning',
    exercise: 'success',
    rest: 'soft',
    cooldown: 'info'
  }[type] || 'info');
}

function formatCompact(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function playPhaseBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close();
  } catch (e) {}
}

function pulseVibration() {
  try {
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  } catch (e) {}
}

function calcWorkoutProgress() {
  const workout = state.workoutEngine.selectedWorkout;
  if (!workout) return 0;
  const totalSec = Math.max(Number(state.workoutEngine.flowTotalSeconds || Number(workout.duration_minutes || 0) * 60), 1);
  return Math.max(0, Math.min(100, Math.round((state.workoutEngine.flowElapsedSeconds / totalSec) * 100)));
}

function calcBurnedCalories(workout, completedMinutes) {
  const fullDuration = Math.max(Number(workout.duration_minutes || 1), 1);
  const fullCalories = Math.max(Number(workout.estimated_calories || 0), 0);
  return Math.max(1, Math.round((completedMinutes / fullDuration) * fullCalories));
}

function resetWorkoutEngine(clearMessage = true) {
  stopWorkoutTimer();
  state.workoutEngine.active = false;
  state.workoutEngine.paused = false;
  state.workoutEngine.startedAt = null;
  state.workoutEngine.elapsedSeconds = 0;
  state.workoutEngine.selectedWorkout = null;
  state.workoutEngine.currentFlow = [];
  state.workoutEngine.currentPhaseIndex = 0;
  state.workoutEngine.currentPhaseRemaining = 0;
  state.workoutEngine.flowTotalSeconds = 0;
  state.workoutEngine.flowElapsedSeconds = 0;
  state.workoutEngine.currentPhase = null;
  state.workoutEngine.nextPhase = null;
  if (clearMessage) state.workoutEngine.message = '';
}

function stopWorkoutTimer() {
  if (state.workoutEngine.intervalId) {
    clearInterval(state.workoutEngine.intervalId);
    state.workoutEngine.intervalId = null;
  }
}

function mergeSessions(primary, secondary) {
  const map = new Map();
  [...(primary || []), ...(secondary || [])].forEach(item => {
    if (!item) return;
    const key = item.id || `${item.user_id}_${item.started_at}_${item.workout_name}`;
    if (!map.has(key)) map.set(key, item);
  });
  return [...map.values()].sort((a, b) => new Date(b.started_at || b.ended_at || 0) - new Date(a.started_at || a.ended_at || 0));
}

function readLocalSessions() {
  try {
    return JSON.parse(localStorage.getItem('liyaqa_sessions') || '[]');
  } catch {
    return [];
  }
}

function writeLocalSession(record) {
  const current = readLocalSessions();
  const merged = mergeSessions([record], current);
  localStorage.setItem('liyaqa_sessions', JSON.stringify(merged.slice(0, 20)));
}

function formatElapsed(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return [hrs, mins, secs].map(v => String(v).padStart(2, '0')).join(':');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ar-EG', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function cryptoRandomId() {
  return (window.crypto?.randomUUID?.() || `local_${Date.now()}_${Math.random().toString(16).slice(2)}`);
}

function goalLabel(v) {
  return ({ weight_loss: 'خفض الوزن', fitness: 'لياقة عامة', muscle: 'بناء عضل', wellness: 'عافية' }[v] || '—');
}

function labelIntensity(v) {
  return ({ low: 'منخفضة', medium: 'متوسطة', high: 'عالية' }[v] || v || '—');
}

function qs(s) { return document.querySelector(s); }
function qsa(s) { return [...document.querySelectorAll(s)]; }
function val(sel) { return qs(sel)?.value || ''; }
function num(sel) { return Number(val(sel) || 0); }
function setText(sel, val) { const el = qs(sel); if (el) el.textContent = val; }
function toggle(el, cls, on) { if (el) el.classList.toggle(cls, on); }
function on(sel, event, handler) { const el = qs(sel); if (el) el.addEventListener(event, handler); }
