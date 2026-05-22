// Supabase Edge Function: generate-bulletin-comment
// Reçoit les données structurées d'un étudiant + un ton, appelle Claude Haiku,
// renvoie un commentaire général de bulletin scolaire.
//
// Secret requis : ANTHROPIC_API_KEY

const MODEL = 'claude-haiku-4-5-20251001';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const TONE_INSTRUCTIONS: Record<string, string> = {
  bienveillant:
    "REGISTRE : très positif, valorisant, encourageant. " +
    "STRUCTURE OBLIGATOIRE : (1) ouvre sur un point fort ou un progrès, (2) reconnais les efforts fournis, " +
    "(3) recadre les difficultés en opportunités d'apprentissage avec un conseil bienveillant, (4) conclus par une projection optimiste. " +
    "VOCABULAIRE À PRIVILÉGIER : 'progrès', 'engagement', 'potentiel', 'qualité', 'détermination', 'force', 'félicitations', 'belle dynamique'. " +
    "ADRESSE OBLIGATOIRE : prénom de l'étudiant·e + 3ème personne du singulier ('Maximilien a démontré…', 'Il/Elle fait preuve…'). " +
    "Le prénom est utilisé au moins dans la phrase d'ouverture, jamais le nom de famille. " +
    "JAMAIS de tutoiement ni de vouvoiement, jamais d'adresse directe à l'étudiant·e. " +
    "À PROSCRIRE ABSOLUMENT : 'insuffisant', 'manque', 'préoccupant', 'décevant', 'regrettable', toute formulation qui pourrait démoraliser. " +
    "Même si les résultats sont faibles, le commentaire doit donner envie de poursuivre les efforts.",
  neutre:
    "REGISTRE : strictement factuel, institutionnel, sans coloration affective. " +
    "STRUCTURE OBLIGATOIRE : (1) constat factuel de la moyenne et du positionnement, " +
    "(2) énumération équilibrée des forces et des points à travailler, (3) état des lieux de la présence si pertinent, (4) conclusion sobre. " +
    "VOCABULAIRE À PRIVILÉGIER : 'résultats', 'compétences acquises', 'à consolider', 'présence', 'positionnement', 'bilan'. " +
    "ADRESSE OBLIGATOIRE : prénom de l'étudiant·e + 3ème personne du singulier ('Maximilien obtient une moyenne de…', 'Ses résultats sont…'). " +
    "Le prénom est utilisé au moins dans la phrase d'ouverture, jamais le nom de famille. " +
    "JAMAIS de tutoiement ni de vouvoiement, jamais d'adresse directe à l'étudiant·e. " +
    "À PROSCRIRE : superlatifs élogieux ('remarquable', 'excellent', 'félicitations'), jugements appuyés ('inacceptable', 'préoccupant'), " +
    "exhortations ('continuez', 'redressez-vous'). Le commentaire doit ressembler à une fiche d'évaluation administrative.",
  dur:
    "REGISTRE : ferme, exigeant, sans complaisance. Le commentaire doit faire prendre conscience d'un écart entre les attentes et les résultats. " +
    "STRUCTURE OBLIGATOIRE : (1) ouvre directement sur le constat le plus problématique (note basse, absence, rattrapage, désengagement…), " +
    "(2) énumère sans détour les manquements, (3) si quelques points positifs existent, ils sont mentionnés brièvement et sans euphémisme, " +
    "(4) conclus par l'expectation explicite d'un redressement et le rappel des standards de l'établissement. " +
    "VOCABULAIRE À PRIVILÉGIER : 'insuffisant', 'manquements', 'écart', 'préoccupant', 'décevant', 'inacceptable', 'doit impérativement', 'redressement attendu', 'mise en garde'. " +
    "ADRESSE OBLIGATOIRE : prénom de l'étudiant·e + 3ème personne du singulier ('Maximilien présente des résultats insuffisants…', 'Il/Elle doit impérativement…'). " +
    "Le prénom est utilisé au moins dans la phrase d'ouverture, jamais le nom de famille. " +
    "JAMAIS de tutoiement ni de vouvoiement, jamais d'adresse directe à l'étudiant·e. " +
    "À PROSCRIRE : encouragements gratuits, adoucissement des constats, formules valorisantes non méritées, projection optimiste. " +
    "Ne jamais commencer par un compliment pour adoucir la suite. La sévérité du ton doit être perceptible dès la première phrase.",
};

function formatNote(m: any): string {
  if (m.absence === 'AJ') return 'AJ (absence justifiée)';
  if (m.absence === 'ANJ') return 'ANJ (absence non justifiée — comptée 0)';
  if (m.valide && (m.note === null || m.note === undefined || m.note === '')) return 'Validé';
  if (m.note !== null && m.note !== undefined && m.note !== '') {
    const n = Number(m.note);
    return Number.isFinite(n) ? `${n.toFixed(1)}/20` : 'En attente';
  }
  return 'En attente';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!KEY) return json({ error: 'ANTHROPIC_API_KEY not configured on Supabase secrets' }, 500);

    const body = await req.json();
    const { student, modules, attendance, tone } = body || {};

    if (!student || !Array.isArray(modules)) {
      return json({ error: 'Missing required fields: student, modules' }, 400);
    }
    const toneKey = (tone || 'neutre').toLowerCase();
    const toneInstruction = TONE_INSTRUCTIONS[toneKey] || TONE_INSTRUCTIONS['neutre'];

    const moduleLines = modules.map((m: any) => {
      const note = formatNote(m);
      const com = m.commentaire ? ` — Commentaire enseignant : « ${m.commentaire} »` : '';
      return `- [${m.pilier || '—'}] ${m.nom} : ${note}${com}`;
    }).join('\n');

    let attLine = "Données de présence non fournies.";
    if (attendance && attendance.totalHours > 0) {
      const pct = attendance.absencePct?.toFixed(1) ?? '0.0';
      attLine =
        `Volume horaire total : ${attendance.totalHours.toFixed(1)}h. ` +
        `Heures d'absence : ${(attendance.totalAbsence || 0).toFixed(1)}h ` +
        `(dont AJ ${(attendance.ajHours || 0).toFixed(1)}h, ANJ ${(attendance.anjHours || 0).toFixed(1)}h). ` +
        `Taux d'absence global : ${pct}%.`;
    }

    const systemPrompt =
      "Tu es un enseignant expérimenté de Delta Business School, une école de commerce. " +
      "Tu rédiges le commentaire général de fin d'année qui apparaîtra sur le bulletin scolaire d'un·e étudiant·e.\n\n" +
      "RÈGLES TECHNIQUES (impératives) :\n" +
      "- Longueur : entre 80 et 150 mots, en un seul paragraphe fluide (pas de liste à puces, pas de titre).\n" +
      "- Objectivité factuelle : tu peux SEULEMENT t'appuyer sur les notes, commentaires de modules et données de présence fournis. " +
      "N'invente JAMAIS de faits, de chiffres ou de comportements qui ne sont pas dans le contexte. " +
      "Mais à l'intérieur de ces faits, le ton imposé ci-dessous dicte la manière de les présenter (cadrage, vocabulaire, ordre, registre).\n" +
      "- Pas d'emojis, pas de signature, pas de mention de l'enseignant ni de l'établissement.\n" +
      "- Si plusieurs modules sont en attente, mentionne-le brièvement sans en faire le sujet principal.\n" +
      "- Si l'absentéisme est notable (taux > 10% ou ANJ > 14h), tu DOIS le mentionner.\n\n" +
      "TON À ADOPTER (priorité maximale — la coloration du commentaire doit être nettement reconnaissable) :\n" +
      toneInstruction +
      "\n\nIMPORTANT : trois personnes différentes lisant trois versions du même commentaire (bienveillant/neutre/dur) doivent immédiatement reconnaître le ton dès la première phrase. Évite tout métissage des registres.";

    const userPrompt =
      `Étudiant·e : ${student.prenom || ''} ${student.nom || ''}\n` +
      `Promotion : ${student.promo || ''}\n\n` +
      `Notes et appréciations par module :\n${moduleLines}\n\n` +
      `Présence :\n${attLine}\n\n` +
      `Rédige le commentaire général du bulletin.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return json({ error: 'Anthropic API error', status: r.status, detail }, 502);
    }
    const data = await r.json();
    const text = data?.content?.[0]?.text || '';
    const usage = data?.usage || {};
    // Haiku 4.5 pricing : $1/MTok input, $5/MTok output
    const inTok = usage.input_tokens || 0;
    const outTok = usage.output_tokens || 0;
    const costUsd = (inTok * 1 + outTok * 5) / 1_000_000;
    return json({
      commentaire: text.trim(),
      model: MODEL,
      tone: toneKey,
      usage: { input_tokens: inTok, output_tokens: outTok, cost_usd: costUsd }
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
