import NextAuth from "next-auth";
import { authConfig } from "@/app/auth/config/config";

export default NextAuth(authConfig); 