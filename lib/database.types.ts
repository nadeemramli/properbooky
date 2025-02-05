export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      books: {
        Row: {
          created_at: string | null
          format: string
          id: string
          metadata: Json | null
          priority_score: number | null
          search_vector: unknown | null
          status: string
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          format: string
          id?: string
          metadata?: Json | null
          priority_score?: number | null
          search_vector?: unknown | null
          status?: string
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          format?: string
          id?: string
          metadata?: Json | null
          priority_score?: number | null
          search_vector?: unknown | null
          status?: string
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      challenges: {
        Row: {
          created_at: string
          days_left: number | null
          description: string
          end_date: string | null
          id: string
          progress: number
          reward: string | null
          start_date: string
          status: string
          title: string
          total: number
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days_left?: number | null
          description: string
          end_date?: string | null
          id?: string
          progress?: number
          reward?: string | null
          start_date?: string
          status?: string
          title: string
          total: number
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days_left?: number | null
          description?: string
          end_date?: string | null
          id?: string
          progress?: number
          reward?: string | null
          start_date?: string
          status?: string
          title?: string
          total?: number
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      highlights: {
        Row: {
          book_id: string
          content: string
          created_at: string | null
          id: string
          page_number: number | null
          search_vector: unknown | null
          tags: Json | null
          user_id: string
        }
        Insert: {
          book_id: string
          content: string
          created_at?: string | null
          id?: string
          page_number?: number | null
          search_vector?: unknown | null
          tags?: Json | null
          user_id: string
        }
        Update: {
          book_id?: string
          content?: string
          created_at?: string | null
          id?: string
          page_number?: number | null
          search_vector?: unknown | null
          tags?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlights_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      missions: {
        Row: {
          created_at: string
          description: string
          end_date: string | null
          icon_type: string
          id: string
          progress: number
          start_date: string
          status: string
          target_books: Json | null
          target_tags: Json | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description: string
          end_date?: string | null
          icon_type: string
          id?: string
          progress?: number
          start_date?: string
          status?: string
          target_books?: Json | null
          target_tags?: Json | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          end_date?: string | null
          icon_type?: string
          id?: string
          progress?: number
          start_date?: string
          status?: string
          target_books?: Json | null
          target_tags?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      obsidian_sync: {
        Row: {
          created_at: string | null
          last_sync_time: string | null
          obsidian_api_token: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          last_sync_time?: string | null
          obsidian_api_token?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          last_sync_time?: string | null
          obsidian_api_token?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reading_activities: {
        Row: {
          book_id: string
          details: Json | null
          id: string
          timestamp: string
          type: string
          user_id: string
        }
        Insert: {
          book_id: string
          details?: Json | null
          id?: string
          timestamp?: string
          type: string
          user_id: string
        }
        Update: {
          book_id?: string
          details?: Json | null
          id?: string
          timestamp?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_activities_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_sessions: {
        Row: {
          book_id: string
          created_at: string
          end_time: string | null
          id: string
          pages_read: number | null
          start_time: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          end_time?: string | null
          id?: string
          pages_read?: number | null
          start_time: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          end_time?: string | null
          id?: string
          pages_read?: number | null
          start_time?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reading_sessions_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_statistics: {
        Row: {
          books_completed: number
          created_at: string
          daily_average: number
          id: string
          monthly_data: Json
          pages_read: number
          reading_time: number
          updated_at: string
          user_id: string
          weekly_change: number
          weekly_data: Json
        }
        Insert: {
          books_completed?: number
          created_at?: string
          daily_average?: number
          id?: string
          monthly_data?: Json
          pages_read?: number
          reading_time?: number
          updated_at?: string
          user_id: string
          weekly_change?: number
          weekly_data?: Json
        }
        Update: {
          books_completed?: number
          created_at?: string
          daily_average?: number
          id?: string
          monthly_data?: Json
          pages_read?: number
          reading_time?: number
          updated_at?: string
          user_id?: string
          weekly_change?: number
          weekly_data?: Json
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string | null
          id: string
          name: string
          parent_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      gtrgm_compress: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      gtrgm_decompress: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      gtrgm_in: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      gtrgm_options: {
        Args: {
          "": unknown
        }
        Returns: undefined
      }
      gtrgm_out: {
        Args: {
          "": unknown
        }
        Returns: unknown
      }
      set_limit: {
        Args: {
          "": number
        }
        Returns: number
      }
      show_limit: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      show_trgm: {
        Args: {
          "": string
        }
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
