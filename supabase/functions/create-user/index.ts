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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No autorizado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: callerData, error: callerError } = await supabase.auth.getUser(token);

    if (callerError || !callerData.user) {
      return new Response(
        JSON.stringify({ error: "Token inválido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const callerId = callerData.user.id;

    // Fetch caller's profile (service role bypasses RLS)
    const { data: callerProfile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .maybeSingle();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ error: "No tiene permisos para crear usuarios" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const isMaster = callerProfile.role === "master";

    const body = await req.json();
    const { email, full_name, role, is_active, organization_id, org_role } = body;

    if (!email) {
      return new Response(
        JSON.stringify({ error: "El correo electrónico es obligatorio" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let targetOrgId: string | null = null;
    let targetOrgRole: string = "user";

    if (isMaster) {
      // Master can optionally assign to an org during creation
      if (organization_id) {
        targetOrgId = organization_id;
        targetOrgRole = org_role || "user";
      }
    } else {
      // Non-master: must be an org admin of the specified organization
      if (!organization_id) {
        return new Response(
          JSON.stringify({ error: "Debe especificar la organización" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: uoData, error: uoError } = await supabase
        .from("user_organizations")
        .select("role")
        .eq("user_id", callerId)
        .eq("organization_id", organization_id)
        .maybeSingle();

      if (uoError || !uoData || uoData.role !== "admin") {
        return new Response(
          JSON.stringify({ error: "No tiene permisos de administrador en esta organización" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      targetOrgId = organization_id;
      // Org admins can only assign 'admin' or 'user' roles within their org
      targetOrgRole = org_role === "admin" ? "admin" : "user";
    }

    // Determine the profile role: master can set any, org admin always creates 'user'
    const profileRole = isMaster ? (role || "user") : "user";

    // Create the auth user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: email,
      password: body.password || "RelaERP2026!",
      email_confirm: true,
      user_metadata: {
        full_name: full_name || "",
        role: profileRole,
      },
    });

    if (createError || !newUser.user) {
      return new Response(
        JSON.stringify({ error: createError?.message || "Error al crear usuario" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update the profile with the correct role and active status
    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({
        full_name: full_name || "",
        role: profileRole,
        is_active: is_active !== undefined ? is_active : true,
      })
      .eq("id", newUser.user.id);

    if (profileUpdateError) {
      return new Response(
        JSON.stringify({ error: "Usuario creado pero error al actualizar perfil", detail: profileUpdateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // If an org assignment is needed, do it here atomically
    if (targetOrgId) {
      const { error: assignError } = await supabase
        .from("user_organizations")
        .insert({
          user_id: newUser.user.id,
          organization_id: targetOrgId,
          role: targetOrgRole,
        });

      if (assignError) {
        return new Response(
          JSON.stringify({ error: "Usuario creado pero error al asignar a la organización", detail: assignError.message, user_id: newUser.user.id }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(
      JSON.stringify({
        message: "Usuario creado exitosamente",
        user_id: newUser.user.id,
        organization_id: targetOrgId,
        org_role: targetOrgId ? targetOrgRole : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Error interno", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
