'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import s from './landing.module.css';
import DemoModal from '@/app/components/DemoModal';

// --- Heatmap data ---
const heatmapRows = [
  { entity: 'Kairo', values: [19, 12, 8, 11, 31], highlight: true },
  { entity: 'Gong', values: [78, 71, 82, 69, 88] },
  { entity: 'Clari', values: [61, 58, 44, 72, 65] },
  { entity: 'Chorus', values: [45, 39, 51, 38, 42] },
  { entity: 'Salesloft', values: [33, 44, 29, 41, 37] },
  { entity: 'Outreach', values: [29, 31, 22, 35, 28] },
  { entity: 'No Brand Visible', values: [12, 18, 9, 24, 6], noFill: true },
];
const heatmapCols = ['DeepSeek', 'Gemini', 'Perplexity', 'GPT-4o', 'Claude'];

// --- Sidebar nav items ---
const sidebarItems = [
  'AEO Roadmap',
  'Overview',
  'AI Share of Voice',
  'AI Tone of Voice',
  'Brand Knowledge',
  'Source Intelligence',
  'Query Runs',
  'Tracking Setup',
];

// --- LLM trust strip ---
const llmPills = [
  { name: 'ChatGPT', color: '#10a37f' },
  { name: 'Claude', color: '#cc785c' },
  { name: 'Gemini', color: '#8ab4f8' },
  { name: 'Perplexity', color: '#20b2aa' },
  { name: 'DeepSeek', color: '#4da6ff' },
];

// --- Problem cards ---
const problemCards = [
  {
    title: 'Your brand has a narrative in AI. You didn\u2019t write it.',
    body: 'AI models synthesise reviews, articles, forums into a story about your brand \u2014 without your marketing team\u2019s input.',
  },
  {
    title: 'Models disagree. The gaps are exploitable.',
    body: 'ChatGPT, Gemini, and Perplexity often describe the same brand in contradictory ways. Competitors who understand this divergence can actively shape it.',
  },
  {
    title: 'You have no visibility into any of it.',
    body: 'Existing analytics tools measure clicks and rankings. None of them show how AI models represent your brand or recommend your competitors.',
  },
];

// --- How it works steps ---
const steps = [
  {
    num: '01',
    title: 'Brand DNA extraction',
    body: 'We ingest your website and brand context to map your category, competitors, and key battlegrounds.',
  },
  {
    num: '02',
    title: 'Query generation',
    body: '30+ intent-driven queries built for your brand across problem-aware, category, comparative, and validation intents.',
  },
  {
    num: '03',
    title: 'Multi-model interrogation',
    body: 'Every query runs simultaneously across ChatGPT, Claude, Gemini, Perplexity, and DeepSeek.',
  },
  {
    num: '04',
    title: 'Intelligence delivered',
    body: 'Scored, structured, and tracked over time. Share of voice, sentiment, sources, and vulnerability in one view.',
  },
];

// --- Trend chart data ---
const trendLines = [
  { name: 'DeepSeek', color: '#4da6ff', data: [22, 28, 31, 29, 35, 38] },
  { name: 'Gemini', color: '#8ab4f8', data: [18, 21, 19, 24, 22, 26] },
  { name: 'Perplexity', color: '#20b2aa', data: [14, 16, 21, 18, 25, 29] },
  { name: 'GPT-4o', color: '#10a37f', data: [12, 15, 13, 17, 19, 22] },
  { name: 'Claude', color: '#cc785c', data: [28, 32, 35, 38, 41, 45] },
];
const trendXLabels = ['3 Feb', '10 Feb', '17 Feb', '24 Feb', '3 Mar', '10 Mar'];

// SVG chart constants
const CX = { w: 760, h: 280, pL: 50, pR: 20, pT: 25, pB: 45 };
function chartPts(data: number[]) {
  const pw = CX.w - CX.pL - CX.pR, ph = CX.h - CX.pT - CX.pB;
  return data.map((v, i) => ({
    x: CX.pL + (i / (data.length - 1)) * pw,
    y: CX.pT + ph - (v / 100) * ph,
  }));
}
function smoothPath(data: number[]) {
  const pts = chartPts(data);
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = (pts[i - 1].x + pts[i].x) / 2;
    d += ` C ${cpx} ${pts[i - 1].y}, ${cpx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

// --- Brand profile data ---
const brandDna = {
  brand: 'UserGuiding',
  subtitle: 'Digital Adoption',
  category: 'Digital adoption & user onboarding platforms',
  pov: 'Product-led growth shouldn\u2019t require engineering',
  differentiators: ['No-code setup', 'Non-technical teams', 'Self-serve onboarding'],
  battlegrounds: [
    'No-code vs dev-dependent tools',
    'SMB vs enterprise pricing',
    'Ease of onboarding vs feature depth',
  ],
  competitors: ['Pendo', 'Appcues', 'Userpilot', 'WalkMe', 'Userflow'],
  personas: ['Frustrated Product Manager', 'Burned-Out CS Manager'],
};

const sampleQueries = [
  {
    text: 'our new users are dropping off during onboarding and we have no idea why \u2014 how do we actually figure out where people get stuck?',
    tags: [
      { label: 'Problem-Aware', bg: 'rgba(255,75,110,0.1)', color: '#FF4B6E' },
      { label: 'Conversational', bg: '#f3f4f6', color: '#6b7280' },
      { label: 'Score: 9/10', bg: '#f3f4f6', color: '#6b7280' },
    ],
  },
  {
    text: 'we\u2019re spending way too much on customer success just explaining basic features. is there a way to automate this?',
    tags: [
      { label: 'Problem-Aware', bg: 'rgba(255,75,110,0.1)', color: '#FF4B6E' },
      { label: 'Conversational', bg: '#f3f4f6', color: '#6b7280' },
      { label: 'Score: 9/10', bg: '#f3f4f6', color: '#6b7280' },
    ],
  },
  {
    text: 'what\u2019s the best tool for building in-app product tours without needing dev resources?',
    tags: [
      { label: 'Category', bg: 'rgba(123,94,167,0.1)', color: '#7B5EA7' },
      { label: 'Formal', bg: '#f3f4f6', color: '#6b7280' },
      { label: 'Score: 8/10', bg: '#f3f4f6', color: '#6b7280' },
    ],
  },
  {
    text: 'userpilot vs userguiding \u2014 which is better for a non-technical product team?',
    tags: [
      { label: 'Comparative', bg: 'rgba(59,130,246,0.1)', color: '#3b82f6' },
      { label: 'Conversational', bg: '#f3f4f6', color: '#6b7280' },
      { label: 'Score: 9/10', bg: '#f3f4f6', color: '#6b7280' },
    ],
  },
  {
    text: 'does userguiding support event-based segmentation for onboarding flows?',
    tags: [
      { label: 'Validation', bg: 'rgba(34,197,94,0.1)', color: '#22c55e' },
      { label: 'Formal', bg: '#f3f4f6', color: '#6b7280' },
      { label: 'Score: 8/10', bg: '#f3f4f6', color: '#6b7280' },
    ],
  },
];

// --- Roadmap cards data ---
const roadmapCardsData = [
  {
    priority: 'P1',
    priorityColor: '#0D0437',
    category: 'CONTENT DIRECTIVE',
    categoryColor: '#0D0437',
    displacement: 'High displacement velocity',
    title: 'Build \u2018No-Code Onboarding Benchmark\u2019 guide with self-serve implementation framework',
    body: 'Create a comprehensive guide targeting buyers researching onboarding automation without dev resources. Queries #3 and #7 are missed by all 5 models.',
    gapText: 'Query #3 (\u2018what\u2019s the easiest onboarding tool for non-technical teams\u2019) returns 0% mention rate across all models.',
    buttons: ['Copy as Content Brief', 'Mark Done'],
  },
  {
    priority: 'P1',
    priorityColor: '#0D0437',
    category: 'PLACEMENT STRATEGY',
    categoryColor: '#0D0437',
    displacement: 'Moderate visibility gap',
    title: 'Secure feature mentions in \u2018no-code SaaS tools\u2019 and \u2018product-led growth\u2019 roundups on G2, Capterra, TrustRadius',
    body: 'Source Intelligence shows these review platforms influence 34% of Perplexity and GPT-4o answers in your category.',
    gapText: 'G2 and Capterra roundup articles are cited in 12 of 18 queries where Pendo outranks Kairo.',
    buttons: ['Copy as Content Brief', 'Start'],
  },
  {
    priority: 'P2',
    priorityColor: '#7B5EA7',
    category: 'SOURCE STRATEGY',
    categoryColor: '#7B5EA7',
    displacement: 'Low priority',
    title: 'Publish integration documentation for Salesforce and HubSpot on official partner directories',
    body: 'Brand Knowledge shows 28% of validation queries incorrectly describe Kairo\u2019s CRM integrations. Correcting source attribution reduces BVI.',
    gapText: '3 of 5 models hallucinate Salesforce native sync as a Kairo feature. No authoritative source corrects this.',
    buttons: ['Copy as Content Brief', 'Start'],
  },
];

// --- Cell background helper ---
function cellBg(value: number, noFill?: boolean) {
  if (noFill) return {};
  const intensity = Math.min(value / 100, 1);
  return {
    backgroundColor: `rgba(59, 130, 246, ${intensity * 0.55 + 0.05})`,
    color: intensity > 0.45 ? '#fff' : '#1a1a2e',
  };
}

// --- Sidebar component (reused in both mockups) ---
function MockSidebar({ active }: { active: string }) {
  return (
    <div className={s.mockSidebar}>
      <div className={`${s.mockSidebarLogo} ${s.gradientText}`}>Shadovi</div>
      <ul className={s.mockSidebarNav}>
        {sidebarItems.map((item) => (
          <li
            key={item}
            className={item === active ? s.mockSidebarItemActive : s.mockSidebarItem}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  // Scroll-triggered reveal animation
  useEffect(() => {
    const els = pageRef.current?.querySelectorAll(`.${s.reveal}`);
    if (!els) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = el.dataset.delay ? parseFloat(el.dataset.delay) : 0;
            setTimeout(() => {
              el.classList.add(s.revealVisible);
            }, delay);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.12 }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={s.page} ref={pageRef}>
      {/* ========== NAV ========== */}
      <nav className={s.nav}>
        <div className={`${s.navLogo} ${s.gradientText}`}>Shadovi</div>
        <div className={s.navLinks}>
          <a href="#capabilities" className={s.navLink}>Capabilities</a>
          <a href="#how" className={s.navLink}>How it works</a>
          <a href="https://app.shadovi.com" target="_blank" rel="noopener noreferrer" className={s.navLink}>Log in</a>
          <button onClick={() => setDemoOpen(true)} className={s.navDemoBtn}>Request a demo</button>
        </div>
      </nav>

      {/* ========== HERO ========== */}
      <section className={s.hero}>
        <div className={s.heroGrid} />
        <div className={s.heroGlow} />

        <div className={`${s.heroPill} ${s.reveal}`}>
          <span className={s.pulseDot} />
          <span className={s.mono}>AI Brand Intelligence</span>
        </div>

        <h1 className={`${s.heroH1} ${s.reveal}`} data-delay="100">
          Your brand exists in AI.
          <br />
          <span className={s.gradientText}>Do you know what it says?</span>
        </h1>

        <p className={`${s.heroSub} ${s.reveal}`} data-delay="200">
          Shadovi tracks how the world&apos;s leading AI models represent your brand &mdash; across
          every buyer query, competitor comparison, and category conversation.
        </p>

        <div className={`${s.heroCTAs} ${s.reveal}`} data-delay="300">
          <button onClick={() => setDemoOpen(true)} className={s.btnPrimary}>Request a demo &rarr;</button>
          <a href="#capabilities" className={s.btnGhost}>See what we track &rarr;</a>
        </div>

        <div className={`${s.trustStrip} ${s.reveal}`} data-delay="400">
          <span className={s.trustLabel}>Powered by</span>
          <div className={s.trustPills}>
            {llmPills.map((p) => (
              <span key={p.name} className={s.trustPill}>
                <span className={s.trustDot} style={{ backgroundColor: p.color }} />
                {p.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PROBLEM ========== */}
      <section className={s.sectionWrapper} id="capabilities">
        <div className={s.reveal}>
          <p className={s.sectionEyebrow}>The shift</p>
          <h2 className={s.sectionTitle}>AI is now the first stop for buying decisions.</h2>
          <p className={s.sectionSub}>
            Millions of people ask AI models what product to buy, which brand to trust, and how
            companies compare. Most brands have no idea what those answers look like.
          </p>
        </div>
        <div className={s.problemGrid}>
          {problemCards.map((card, i) => (
            <div key={i} className={`${s.problemCard} ${s.reveal}`} data-delay={i * 120}>
              <div className={s.problemCardTitle}>{card.title}</div>
              <div className={s.problemCardBody}>{card.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ========== MOCKUP: SHARE OF VOICE HEATMAP ========== */}
      <section className={s.mockupSection}>
        <div className={s.reveal}>
          <p className={s.sectionEyebrow}>Share of Voice</p>
          <h2 className={s.sectionTitle}>
            See exactly where you&apos;re winning and losing across every model.
          </h2>
          <p className={s.sectionSub}>
            The same query gets different answers on different models. Shadovi maps every gap.
          </p>
        </div>

        <div className={`${s.deviceFrame} ${s.reveal}`} data-delay="150">
          <div className={s.mockupLayout}>
            <MockSidebar active="AI Share of Voice" />
            <div className={s.mockMain}>
              <div className={s.mockPageTitle}>AI Share of Voice</div>
              <div className={s.mockPageSub}>
                How often is your brand recommended vs. competitors across AI models?
              </div>

              {/* Filters */}
              <div className={s.mockFilters}>
                <span className={s.mockFilterPill}>Last 7 days</span>
                <span className={s.mockFilterPill}>Last 30 days</span>
                <span className={s.mockFilterActive}>All time</span>
                <span className={s.mockFilterDivider} />
                <span className={s.mockFilterActive}>All</span>
                <span className={s.mockFilterPill}>Problem-Aware</span>
                <span className={s.mockFilterPill}>Category</span>
                <span className={s.mockFilterDivider} />
                <span className={s.mockFilterActive}>DeepSeek</span>
                <span className={s.mockFilterActive}>Gemini</span>
                <span className={s.mockFilterActive}>Perplexity</span>
                <span className={s.mockFilterActive}>GPT-4o</span>
                <span className={s.mockFilterActive}>Claude</span>
              </div>

              <div className={s.mockSectionHeader}>Share of Model Heatmap</div>
              <table className={s.heatmapTable}>
                <thead>
                  <tr>
                    <th>Entity</th>
                    {heatmapCols.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapRows.map((row) => (
                    <tr key={row.entity} className={row.highlight ? s.heatmapHighlight : undefined}>
                      <td>{row.entity}</td>
                      {row.values.map((v, i) => (
                        <td key={i} style={cellBg(v, row.noFill)}>
                          {v}%
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ========== MOCKUP: BRAND VULNERABILITY INDEX ========== */}
      <section className={s.mockupSection}>
        <div className={s.reveal}>
          <p className={s.sectionEyebrow}>Brand Vulnerability</p>
          <h2 className={s.sectionTitle}>
            Know how exposed your brand is before a crisis finds you.
          </h2>
          <p className={s.sectionSub}>
            Shadovi stress-tests your brand against adversarial queries and false claims &mdash;
            across all five models.
          </p>
        </div>

        <div className={`${s.deviceFrame} ${s.reveal}`} data-delay="150">
          <div className={s.mockupLayout}>
            <MockSidebar active="Brand Knowledge" />
            <div className={s.mockMain}>
              <div className={s.mockPageTitle}>Brand Knowledge</div>
              <div className={`${s.mockPageSub} ${s.mono}`}>
                Are AI models hallucinating false pricing, outdated policies, or damaging narratives
                about Kairo?
              </div>

              {/* Knowledge Accuracy Score cards */}
              <div className={s.mockSectionHeader}>Knowledge Accuracy Score</div>
              <div className={s.bviCards}>
                <div className={s.bviCard}>
                  <div className={s.bviCardLabel}>Overall Accuracy</div>
                  <div className={s.bviCardValue} style={{ color: '#f59e0b' }}>61%</div>
                  <div className={s.bviCardSub}>73 of 120 validation runs scored correctly</div>
                </div>
                <div className={s.bviCard}>
                  <div className={s.bviCardLabel}>Hallucination Alerts</div>
                  <div className={s.bviCardValue} style={{ color: '#FF4B6E' }}>18</div>
                </div>
                <div className={s.bviCard}>
                  <div className={s.bviCardLabel}>Facts Tested</div>
                  <div className={s.bviCardValue} style={{ color: '#0D0437' }}>12</div>
                </div>
              </div>

              {/* BVI Section */}
              <div className={s.bviSection}>
                <div className={s.bviSectionTitle}>Brand Vulnerability Index</div>
                <div className={s.bviRow}>
                  <div className={s.bviMetric}>
                    <div className={s.bviMetricLabel}>BVI Score</div>
                    <div className={s.bviMetricValue} style={{ color: '#f59e0b' }}>34</div>
                  </div>
                  <div className={s.bviMetric}>
                    <div className={s.bviMetricLabel}>Bait Trigger Rate</div>
                    <div className={s.bviMetricValue} style={{ color: '#f59e0b' }}>28%</div>
                  </div>
                  <div className={s.bviMetric}>
                    <div className={s.bviMetricLabel}>Cross-Model Spread</div>
                    <div className={s.bviMetricValue} style={{ color: '#FF4B6E' }}>41%</div>
                  </div>
                </div>
              </div>

              {/* Hallucination Alerts table */}
              <div className={s.mockSectionHeader}>Hallucination Alerts</div>
              <table className={s.alertsTable}>
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Type</th>
                    <th>Results</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Kairo integrates natively with Salesforce for real-time pipeline sync</td>
                    <td><span className={s.tagFalse}>False Claim</span></td>
                    <td>
                      <span className={s.failBadge}>Gemini 4 of 4 failed</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Kairo offers unlimited seats on all plans</td>
                    <td><span className={s.tagFalse}>False Claim</span></td>
                    <td>
                      <span className={s.failBadge}>GPT-4o 3 of 5 failed</span>
                      <span className={s.failBadge}>Perplexity 2 of 5 failed</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ========== SECTION A: VISIBILITY TREND CHART ========== */}
      <section className={s.mockupSection}>
        <div className={s.reveal}>
          <p className={s.sectionEyebrowCyan}>Visibility over time</p>
          <h2 className={s.sectionTitle}>
            Track how your AI presence moves &mdash; across every model, every week.
          </h2>
          <p className={s.sectionSub}>
            Shadovi runs continuously in the background. Every model, every query, every run &mdash;
            logged, scored, and trended.
          </p>
        </div>

        <div className={`${s.deviceFrame} ${s.reveal}`} data-delay="150">
          <div className={s.mockupLayout}>
            <MockSidebar active="AI Share of Voice" />
            <div className={s.mockMain}>
              <div className={s.mockPageTitle}>AI Share of Voice</div>
              <div className={s.mockPageSub}>
                How often is your brand recommended vs. competitors across AI models?
              </div>
              <div className={s.mockSectionHeader}>Visibility Trend &middot; Kairo</div>
              <div className={s.chartArea}>
                <span className={s.chartTag}>Kairo &middot; AI Share of Voice</span>
                <svg viewBox={`0 0 ${CX.w} ${CX.h}`} width="100%" style={{ display: 'block' }}>
                  {/* Y-axis line */}
                  <line x1={CX.pL} y1={CX.pT} x2={CX.pL} y2={CX.pT + (CX.h - CX.pT - CX.pB)} stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
                  {/* X-axis line */}
                  <line x1={CX.pL} y1={CX.pT + (CX.h - CX.pT - CX.pB)} x2={CX.w - CX.pR} y2={CX.pT + (CX.h - CX.pT - CX.pB)} stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
                  {/* Horizontal grid lines at 25%, 50%, 75% */}
                  {[25, 50, 75].map((pct) => {
                    const y = CX.pT + (CX.h - CX.pT - CX.pB) - (pct / 100) * (CX.h - CX.pT - CX.pB);
                    return (
                      <line key={pct} x1={CX.pL} y1={y} x2={CX.w - CX.pR} y2={y}
                        stroke="rgba(0,0,0,0.08)" strokeWidth="1" strokeDasharray="4 4" />
                    );
                  })}
                  {/* Y-axis labels */}
                  {[0, 25, 50, 75, 100].map((pct) => {
                    const y = CX.pT + (CX.h - CX.pT - CX.pB) - (pct / 100) * (CX.h - CX.pT - CX.pB);
                    return (
                      <text key={pct} x={CX.pL - 8} y={y + 4} textAnchor="end"
                        fontSize="10" fill="#9ca3af" fontFamily="var(--font-mono), monospace">
                        {pct}%
                      </text>
                    );
                  })}
                  {/* X-axis labels */}
                  {trendXLabels.map((label, i) => {
                    const x = CX.pL + (i / (trendXLabels.length - 1)) * (CX.w - CX.pL - CX.pR);
                    return (
                      <text key={label} x={x} y={CX.h - CX.pB + 20} textAnchor="middle"
                        fontSize="10" fill="#9ca3af" fontFamily="var(--font-mono), monospace">
                        {label}
                      </text>
                    );
                  })}
                  {/* Lines + dots */}
                  {trendLines.map((line) => (
                    <g key={line.name}>
                      <path d={smoothPath(line.data)} fill="none" stroke={line.color}
                        strokeWidth="2.5" strokeLinecap="round" />
                      {chartPts(line.data).map((pt, i) => (
                        <circle key={i} cx={pt.x} cy={pt.y} r={4} fill={line.color} />
                      ))}
                    </g>
                  ))}
                </svg>
                <div className={s.chartLegend}>
                  {trendLines.map((line) => (
                    <span key={line.name} className={s.chartLegendItem}>
                      <span className={s.chartLegendDot} style={{ backgroundColor: line.color }} />
                      {line.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== SECTION B: BRAND PROFILE → QUERY GENERATION ========== */}
      <section className={s.mockupSection}>
        <div className={s.reveal}>
          <p className={s.sectionEyebrowCyan}>Brand intelligence engine</p>
          <h2 className={s.sectionTitle}>
            Better brand profile. Better queries. Better intelligence.
          </h2>
          <p className={s.sectionSub}>
            Most platforms run generic queries. Shadovi extracts your brand&apos;s DNA first &mdash;
            your positioning, your battlegrounds, your competitors &mdash; and generates queries that
            actually reflect how your buyers think.
          </p>
        </div>

        <div className={`${s.brandProfileFrame} ${s.reveal}`} data-delay="150">
          <div className={s.brandProfileLayout}>
            {/* Left panel — Brand DNA */}
            <div className={s.brandDnaPanel}>
              <div className={s.panelHeader}>Brand DNA</div>
              <div className={s.panelHeaderSub}>
                {brandDna.brand} &middot; {brandDna.subtitle}
              </div>

              <div className={s.brandDnaField}>
                <div className={s.brandDnaLabel}>Category</div>
                <div className={s.brandDnaValue}>{brandDna.category}</div>
              </div>
              <div className={s.brandDnaField}>
                <div className={s.brandDnaLabel}>Brand POV</div>
                <div className={s.brandDnaValue}>{brandDna.pov}</div>
              </div>
              <div className={s.brandDnaField}>
                <div className={s.brandDnaLabel}>Key Differentiators</div>
                <div className={s.pillRow}>
                  {brandDna.differentiators.map((d) => (
                    <span key={d} className={s.pillCoral}>{d}</span>
                  ))}
                </div>
              </div>
              <div className={s.brandDnaField}>
                <div className={s.brandDnaLabel}>Strategic Battlegrounds</div>
                <div className={s.pillRow}>
                  {brandDna.battlegrounds.map((b) => (
                    <span key={b} className={s.pillViolet}>{b}</span>
                  ))}
                </div>
              </div>
              <div className={s.brandDnaField}>
                <div className={s.brandDnaLabel}>Competitors Tracked</div>
                <div className={s.pillRow}>
                  {brandDna.competitors.map((c) => (
                    <span key={c} className={s.pillGrey}>{c}</span>
                  ))}
                </div>
              </div>
              <div className={s.brandDnaField}>
                <div className={s.brandDnaLabel}>Buyer Personas</div>
                <div className={s.pillRow}>
                  {brandDna.personas.map((p) => (
                    <span key={p} className={s.pillBlue}>{p}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Arrow bridge */}
            <div className={s.panelArrow}>&rarr;</div>

            {/* Right panel — Generated queries */}
            <div className={s.queryPanel}>
              <div className={s.panelHeader}>Generated queries</div>
              <div className={s.panelHeaderSub}>40 queries &middot; 4 intent layers</div>

              {sampleQueries.map((q, i) => (
                <div key={i} className={s.queryCardItem}>
                  <div className={s.queryCardText}>{q.text}</div>
                  <div className={s.queryCardTags}>
                    {q.tags.map((t) => (
                      <span key={t.label} className={s.intentTag}
                        style={{ backgroundColor: t.bg, color: t.color }}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div className={s.queryMoreRow}>&middot; &middot; &middot; 35 more queries across all intent layers</div>
            </div>
          </div>
        </div>
      </section>

      {/* ========== SECTION C: AEO ROADMAP ACTION CARDS ========== */}
      <section className={s.mockupSection}>
        <div className={s.reveal}>
          <p className={s.sectionEyebrowCyan}>Action center</p>
          <h2 className={s.sectionTitle}>
            Intelligence that tells you what to do next.
          </h2>
          <p className={s.sectionSub}>
            Shadovi doesn&apos;t just report what&apos;s happening &mdash; it generates a prioritised
            action roadmap from your data, with content briefs and placement strategies you can act
            on immediately.
          </p>
        </div>

        <div className={s.roadmapGrid}>
          {roadmapCardsData.map((card, i) => (
            <div key={i} className={`${s.roadmapCard} ${s.reveal}`} data-delay={i * 120}>
              <div className={s.roadmapCardTop}>
                <span className={s.priorityPill} style={{ backgroundColor: card.priorityColor }}>
                  {card.priority}
                </span>
                <span className={s.categoryOutline}
                  style={{ borderColor: card.categoryColor, color: card.categoryColor }}>
                  {card.category}
                </span>
                <span className={s.displacementText}>{card.displacement}</span>
              </div>
              <div className={s.roadmapCardTitle}>{card.title}</div>
              <div className={s.roadmapCardBody}>{card.body}</div>
              <div className={s.gapBlock}>
                <div className={s.gapLabel}>THE GAP</div>
                <div className={s.gapText}>{card.gapText}</div>
              </div>
              <div className={s.roadmapBtns}>
                <span className={s.roadmapBtnDark}>{card.buttons[0]}</span>
                <span className={s.roadmapBtnLight}>{card.buttons[1]}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ========== HOW IT WORKS ========== */}
      <section className={s.sectionWrapper} id="how">
        <div className={s.reveal}>
          <p className={s.sectionEyebrow}>How it works</p>
          <h2 className={s.sectionTitle}>Intelligence built to your brand.</h2>
        </div>
        <div className={s.stepsGrid}>
          {steps.map((step, i) => (
            <div key={step.num} className={`${s.step} ${s.reveal}`} data-delay={i * 120}>
              <div className={`${s.stepNumber} ${s.gradientText} ${s.mono}`}>{step.num}</div>
              <div className={s.stepTitle}>{step.title}</div>
              <div className={s.stepBody}>{step.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ========== CTA ========== */}
      <section className={s.ctaSection} id="demo">
        <div className={s.reveal}>
          <h2 className={s.ctaTitle}>
            See your brand through the
            <br />
            <span className={s.gradientText}>eyes of AI.</span>
          </h2>
          <p className={s.ctaSub}>
            We run a live intelligence brief on your brand and walk you through what the models are
            saying. No commitment, no contract.
          </p>
          <button
            onClick={() => setDemoOpen(true)}
            className={s.btnPrimary}
          >
            Request a demo &rarr;
          </button>
          <p className={s.ctaNote}>admin@shadovi.com &middot; London, UK</p>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className={s.footer}>
        <span className={s.gradientText} style={{ fontWeight: 700 }}>Shadovi</span>
        <span>&copy; 2025 Shadovi</span>
        <a href="mailto:admin@shadovi.com" className={s.footerLink}>admin@shadovi.com</a>
      </footer>

      <DemoModal isOpen={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
