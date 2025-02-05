import type { AuthOptions, DefaultSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import { createClient } from "@/lib/supabase/server";

// Extend the built-in session types
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      email: string;
      name: string;
      image?: string;
    } & DefaultSession["user"]
  }

  interface User {
    id: string;
    email: string;
    name: string;
    image?: string;
    email_verified?: boolean;
  }
}

// Extend JWT type
declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
    accessToken?: string;
  }
}

if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error("Missing GOOGLE_CLIENT_ID");
}

if (!process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("Missing GOOGLE_CLIENT_SECRET");
}

export const authConfig: AuthOptions = {
  providers: [GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  })],
  callbacks: {
    async signIn({ user, account }) {
      // For Google provider, email is always verified
      if (account?.provider === "google") {
        const supabase = createClient();
        
        // Check if user exists in Supabase
        const { data: existingUser } = await supabase
          .from("users")
          .select()
          .eq("email", user.email)
          .single();

        if (!existingUser) {
          // Create new user in Supabase
          const { error: createError } = await supabase
            .from("users")
            .insert({
              email: user.email,
              name: user.name,
              avatar_url: user.image,
              provider: "google",
            });

          if (createError) {
            console.error("Error creating user:", createError);
            return false;
          }
        }
        return true;
      }

      // For other providers, check email verification
      if (user.email_verified === false) {
        throw new Error("Please verify your email first");
      }

      return true;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token.sub!;
        session.user.email = token.email ?? '';
        session.user.name = token.name ?? '';
        // Only set image if it exists and is not null
        if (token.picture) {
          session.user.image = token.picture;
        }
      }
      return session;
    },
    async jwt({ token, account, user }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        // Only set picture if it exists
        if (user.image) {
          token.picture = user.image;
        }
      }
      return token;
    },
  },
  pages: {
    signIn: "/auth/login",
    error: "/auth/error",
  },
  session: {
    strategy: "jwt",
  },
}; 