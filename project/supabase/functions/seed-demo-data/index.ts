import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: string[] = [];

    // 1. Create demo PH organization (idempotent by NIT)
    const demoNIT = "900.123.456-7";
    const { data: existingOrg } = await supabase
      .from("organizations")
      .select("id")
      .eq("nit", demoNIT)
      .maybeSingle();

    let orgId: string;

    if (existingOrg) {
      orgId = existingOrg.id;
      results.push("Organización demo ya existe, reutilizando.");
    } else {
      const { data: newOrg, error: orgErr } = await supabase
        .from("organizations")
        .insert({
          name: "Conjunto Residencial Los Almendros",
          nit: demoNIT,
          type: "residencial",
          is_active: true,
        })
        .select("id")
        .single();
      if (orgErr) throw new Error(`Error creating org: ${orgErr.message}`);
      orgId = newOrg.id;
      results.push("Organización demo creada: Conjunto Residencial Los Almendros.");
    }

    // 2. Create demo admin user (idempotent by email)
    const adminEmail = "admin@losalmendros.com";
    const adminPassword = "Demo2026*";
    const { data: userList } = await supabase.auth.admin.listUsers();
    const existingAdmin = userList?.users?.find((u) => u.email === adminEmail);

    let adminId: string;

    if (existingAdmin) {
      adminId = existingAdmin.id;
      results.push("Usuario admin demo ya existe.");
    } else {
      const { data: newAdmin, error: adminErr } = await supabase.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: { full_name: "Carlos Ramírez" },
      });
      if (adminErr) throw new Error(`Error creating admin user: ${adminErr.message}`);
      adminId = newAdmin.user!.id;

      await supabase.from("profiles").upsert({
        id: adminId,
        email: adminEmail,
        full_name: "Carlos Ramírez",
        role: "admin",
        is_active: true,
      }, { onConflict: "id" });
    }

    // Link admin to org (idempotent)
    const { data: existingLink } = await supabase
      .from("user_organizations")
      .select("id")
      .eq("user_id", adminId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!existingLink) {
      await supabase.from("user_organizations").insert({
        user_id: adminId,
        organization_id: orgId,
        role: "admin",
      });
      results.push("Usuario admin vinculado a la organización.");
    }

    // 3. Seed units with co-owners (idempotent by org+unit_label)
    const demoUnits = [
      { tower: "Torre A", unit_label: "101", type: "apartamento", coefficient: 0.0250, owner_name: "María González", owner_document: "52.345.678", owner_phone: "3001234567", built_area: 85.5, payment_reference: "REF-A101" },
      { tower: "Torre A", unit_label: "102", type: "apartamento", coefficient: 0.0250, owner_name: "Juan Pérez", owner_document: "79.456.123", owner_phone: "3007654321", built_area: 85.5, payment_reference: "REF-A102" },
      { tower: "Torre A", unit_label: "201", type: "apartamento", coefficient: 0.0300, owner_name: "Andrea Torres", owner_document: "31.987.654", owner_phone: "3012345678", built_area: 95.0, payment_reference: "REF-A201" },
      { tower: "Torre A", unit_label: "202", type: "apartamento", coefficient: 0.0300, owner_name: "Inversiones JTR SAS", owner_document: "900.555.111", owner_phone: "3109876543", built_area: 95.0, payment_reference: "REF-A202" },
      { tower: "Torre B", unit_label: "101", type: "apartamento", coefficient: 0.0250, owner_name: "Pedro Martínez", owner_document: "43.111.222", owner_phone: "3201112233", built_area: 85.5, payment_reference: "REF-B101" },
      { tower: "Torre B", unit_label: "102", type: "apartamento", coefficient: 0.0250, owner_name: "Laura Sánchez", owner_document: "44.222.333", owner_phone: "3202223344", built_area: 85.5, payment_reference: "REF-B102" },
      { tower: "Torre B", unit_label: "201", type: "apartamento", coefficient: 0.0300, owner_name: "Carlos Vargas", owner_document: "15.333.444", owner_phone: "3203334455", built_area: 95.0, payment_reference: "REF-B201" },
      { tower: "Torre B", unit_label: "202", type: "apartamento", coefficient: 0.0300, owner_name: "Diana Ruiz", owner_document: "71.444.555", owner_phone: "3204445566", built_area: 95.0, payment_reference: "REF-B202" },
      { tower: "Parqueadero", unit_label: "P-01", type: "parqueadero", coefficient: 0.0050, owner_name: "María González", owner_document: "52.345.678", owner_phone: "3001234567", built_area: 12.0 },
      { tower: "Parqueadero", unit_label: "P-02", type: "parqueadero", coefficient: 0.0050, owner_name: "Juan Pérez", owner_document: "79.456.123", owner_phone: "3007654321", built_area: 12.0 },
      { tower: "Zona Comercial", unit_label: "LC-01", type: "local", coefficient: 0.0400, owner_name: "Comercial Andina SAS", owner_document: "901.222.333", owner_phone: "3305556677", built_area: 120.0, payment_reference: "REF-LC01" },
      { tower: "Zona Comercial", unit_label: "LC-02", type: "local", coefficient: 0.0400, owner_name: "Farmacia Central Ltda", owner_document: "902.333.444", owner_phone: "3306667788", built_area: 80.0, payment_reference: "REF-LC02" },
    ];

    let unitsCreated = 0;
    for (const du of demoUnits) {
      const { data: existingUnit } = await supabase
        .from("units")
        .select("id")
        .eq("organization_id", orgId)
        .eq("unit_label", du.unit_label)
        .eq("tower", du.tower)
        .maybeSingle();

      let unitId: string;
      if (existingUnit) {
        unitId = existingUnit.id;
      } else {
        const { data: newUnit, error: unitErr } = await supabase
          .from("units")
          .insert({
            organization_id: orgId,
            tower: du.tower,
            unit_label: du.unit_label,
            type: du.type,
            coefficient: du.coefficient,
            owner_name: du.owner_name,
            owner_document: du.owner_document,
            owner_phone: du.owner_phone,
            built_area: du.built_area,
            payment_reference: du.payment_reference || null,
            is_active: true,
          })
          .select("id")
          .single();
        if (unitErr) throw new Error(`Error creating unit ${du.unit_label}: ${unitErr.message}`);
        unitId = newUnit.id;
        unitsCreated++;

        // Create unit_owner (position 1)
        const isBusiness = du.owner_name.includes("SAS") || du.owner_name.includes("Ltda");
        await supabase.from("unit_owners").insert({
          organization_id: orgId,
          unit_id: unitId,
          position: 1,
          is_primary: true,
          document_type: isBusiness ? "NIT" : "CC",
          document_number: du.owner_document,
          first_name: isBusiness ? "" : du.owner_name.split(" ")[0] || "",
          last_name: isBusiness ? "" : du.owner_name.split(" ").slice(1).join(" ") || "",
          business_name: isBusiness ? du.owner_name : "",
          email: "",
          phone: du.owner_phone || "",
        });
      }
    }
    if (unitsCreated > 0) results.push(`${unitsCreated} unidades creadas con propietarios.`);

    // 4. Seed revenue period (idempotent by org+name)
    const periodName = "Administración Mensual 2026";
    const { data: existingPeriod } = await supabase
      .from("revenue_periods")
      .select("id")
      .eq("organization_id", orgId)
      .eq("name", periodName)
      .maybeSingle();

    let periodId: string;

    if (existingPeriod) {
      periodId = existingPeriod.id;
      results.push("Periodo de recaudo ya existe.");
    } else {
      const { data: newPeriod, error: periodErr } = await supabase
        .from("revenue_periods")
        .insert({
          organization_id: orgId,
          name: periodName,
          frequency: "mensual",
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          billing_day: 1,
          due_day: 10,
          grace_days: 5,
          offset_days: 0,
          interest_start_date: "2026-01-16",
          late_interest_rate: 0.0120,
          discount_threshold_days: 5,
          discount_rate: 0.1000,
          is_active: true,
        })
        .select("id")
        .single();
      if (periodErr) throw new Error(`Error creating period: ${periodErr.message}`);
      periodId = newPeriod.id;
      results.push("Periodo de recaudo creado: Administración Mensual 2026.");
    }

    // 5. Seed billing concepts (idempotent by org+code)
    const concepts = [
      { code: "ADM", name: "Cuota de Administración", description: "Cuota ordinaria mensual Ley 675/2001", category: "administracion", account_class: "real", is_default: true },
      { code: "EXT", name: "Cuota Extraordinaria", description: "Fondo de mantenimiento extraordinario", category: "extraordinaria", account_class: "real" },
      { code: "RES", name: "Fondo de Reservas", description: "Reserva legal conforme Ley 675/2001 Art. 36", category: "reserva", account_class: "real" },
      { code: "SRV", name: "Servicio de Parqueadero", description: "Cuota adicional por uso de parqueadero", category: "servicio", account_class: "real" },
    ];

    let conceptsCreated = 0;
    for (const c of concepts) {
      const { data: existingConcept } = await supabase
        .from("billing_concepts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("code", c.code)
        .maybeSingle();
      if (!existingConcept) {
        await supabase.from("billing_concepts").insert({
          organization_id: orgId,
          code: c.code,
          name: c.name,
          description: c.description,
          category: c.category,
          account_class: c.account_class,
          is_default: c.is_default || false,
          is_active: true,
        });
        conceptsCreated++;
      }
    }
    if (conceptsCreated > 0) results.push(`${conceptsCreated} conceptos de cobro creados.`);

    // 6. Seed discount tiers (idempotent: check existing for this period)
    const { count: existingTiers } = await supabase
      .from("discount_tiers")
      .select("*", { count: "exact", head: true })
      .eq("revenue_period_id", periodId);

    if ((existingTiers || 0) === 0) {
      const tiers = [
        { tier_order: 1, name: "Pronto Pago Nivel 1", discount_type: "porcentaje", discount_value: 15, valid_until_day: 5, is_active: true },
        { tier_order: 2, name: "Pronto Pago Nivel 2", discount_type: "porcentaje", discount_value: 10, valid_until_day: 8, is_active: true },
        { tier_order: 3, name: "Pronto Pago Nivel 3", discount_type: "porcentaje", discount_value: 5, valid_until_day: 12, is_active: true },
      ];
      for (const t of tiers) {
        await supabase.from("discount_tiers").insert({
          organization_id: orgId,
          revenue_period_id: periodId,
          ...t,
        });
      }
      results.push("3 escalones de descuento creados (15% día 5, 10% día 8, 5% día 12).");
    } else {
      results.push("Escalones de descuento ya existen.");
    }

    return new Response(
      JSON.stringify({
        message: "Datos demo sembrados exitosamente",
        orgId,
        periodId,
        adminEmail,
        adminPassword,
        details: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Seed demo data failed", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
