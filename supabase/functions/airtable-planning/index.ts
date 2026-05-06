// Supabase Edge Function: airtable-planning
// Proxy vers l'API Airtable pour récupérer le planning d'une promotion.
// Le PAT Airtable est lu depuis l'environnement (secret AIRTABLE_PAT).

const AIRTABLE_BASE_ID  = 'appfzjAJsIheUOSRf';
const AIRTABLE_TABLE_ID = 'tblSpKfGiUXbqkUu5';

// Mapping promotion portail → valeur du champ "Classe" côté Airtable
const PROMO_TO_CLASSE: Record<string, string> = {
  'B1':    '25_26_B1',
  'B2':    '25_26_B2',
  'B3':    '24_25_B2',  // carry-forward de l'année précédente
  'MCOM1': '25_26_M1',
  'MCOM2': '25_26_M2',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const PAT = Deno.env.get('AIRTABLE_PAT');
    if (!PAT) {
      return json({ error: 'AIRTABLE_PAT not configured on Supabase secrets' }, 500);
    }

    const url = new URL(req.url);
    const promo = url.searchParams.get('promo') || '';
    if (!PROMO_TO_CLASSE[promo]) {
      return json({
        error: 'Invalid or missing "promo" query param',
        expected: Object.keys(PROMO_TO_CLASSE),
        received: promo,
      }, 400);
    }
    const classe = PROMO_TO_CLASSE[promo];
    const formula = `{Classe} = '${classe}'`;

    // Pagination Airtable (max 100 records per page)
    const allRecords: any[] = [];
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({
        filterByFormula: formula,
        pageSize: '100',
      });
      if (offset) params.set('offset', offset);

      const r = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?${params.toString()}`,
        { headers: { Authorization: `Bearer ${PAT}` } },
      );
      if (!r.ok) {
        const details = await r.text();
        return json({ error: 'Airtable API error', status: r.status, details }, 502);
      }
      const data = await r.json();
      allRecords.push(...(data.records || []));
      offset = data.offset;
    } while (offset);

    // Simplification de la réponse
    const records = allRecords.map((rec: any) => ({
      id:          rec.id,
      activity:    rec.fields['Activity']    ?? '',
      pilier:      rec.fields['Pilier']      ?? '',
      session:     rec.fields['Session']     ?? null,
      sessionId:   rec.fields['ID']          ?? '',
      week:        rec.fields['#Week']       ?? null,
      startDate:   rec.fields['Start Date']  ?? null,
      endDate:     rec.fields['End Date']    ?? null,
      duration:    rec.fields['Duration']    ?? null,
      type:        rec.fields['Type']        ?? '',
      classe:      rec.fields['Classe']      ?? '',
    }));

    return json({ promo, classe, count: records.length, records });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
