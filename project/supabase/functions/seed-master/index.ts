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

    const masterEmail = "masinforela@gmail.com";
    const masterPassword = "Samantha2112*";

    // Check if the user already exists
    const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      return new Response(
        JSON.stringify({ error: "Error listing users", detail: listError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const existing = existingUsers.users.find((u) => u.email === masterEmail);

    if (existing) {
      // Ensure profile has master role
      const { error: profileError } = await supabase
        .from("profiles")
        .upsert({
          id: existing.id,
          email: masterEmail,
          full_name: "Administrador Principal",
          role: "master",
          is_active: true,
        }, { onConflict: "id" });

      if (profileError) {
        return new Response(
          JSON.stringify({ error: "Error updating profile", detail: profileError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ message: "Usuario master ya existe y perfil actualizado", email: masterEmail }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the master user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: masterEmail,
      password: masterPassword,
      email_confirm: true,
      user_metadata: {
        full_name: "Administrador Principal",
        role: "master",
      },
    });

    if (createError || !newUser.user) {
      return new Response(
        JSON.stringify({ error: "Error creating master user", detail: createError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The trigger will create the profile, but we ensure the role is master
    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: newUser.user.id,
        email: masterEmail,
        full_name: "Administrador Principal",
        role: "master",
        is_active: true,
      }, { onConflict: "id" });

    if (profileError) {
      return new Response(
        JSON.stringify({ error: "Error creating profile", detail: profileError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ message: "Usuario master creado exitosamente", email: masterEmail }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
