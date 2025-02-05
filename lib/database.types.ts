export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      books: {
        Row: {
          id: string
          user_id: string
          title: string
          author: string | null
          cover_url: string | null
          file_url: string
          format: 'epub' | 'pdf'
          status: 'unread' | 'reading' | 'completed'
          progress: number | null
          priority_score: number | null
          metadata: Json | null
          created_at: string
          updated_at: string
          last_read: string | null
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          author?: string | null
          cover_url?: string | null
          file_url: string
          format: 'epub' | 'pdf'
          status?: 'unread' | 'reading' | 'completed'
          progress?: number | null
          priority_score?: number | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
          last_read?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          author?: string | null
          cover_url?: string | null
          file_url?: string
          format?: 'epub' | 'pdf'
          status?: 'unread' | 'reading' | 'completed'
          progress?: number | null
          priority_score?: number | null
          metadata?: Json | null
          created_at?: string
          updated_at?: string
          last_read?: string | null
        }
      }
      reading_statistics: {
        Row: {
          id: string
          user_id: string
          pages_read: number
          reading_time: number
          books_completed: number
          daily_average: number
          weekly_data: Json
          monthly_data: Json
          weekly_change: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          pages_read?: number
          reading_time?: number
          books_completed?: number
          daily_average?: number
          weekly_data?: Json
          monthly_data?: Json
          weekly_change?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          pages_read?: number
          reading_time?: number
          books_completed?: number
          daily_average?: number
          weekly_data?: Json
          monthly_data?: Json
          weekly_change?: number
          created_at?: string
          updated_at?: string
        }
      }
      challenges: {
        Row: {
          id: string
          user_id: string
          title: string
          description: string
          type: 'daily' | 'weekly' | 'monthly' | 'special'
          progress: number
          total: number
          days_left: number | null
          reward: string | null
          status: 'active' | 'completed' | 'failed'
          start_date: string
          end_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          description: string
          type: 'daily' | 'weekly' | 'monthly' | 'special'
          progress?: number
          total: number
          days_left?: number | null
          reward?: string | null
          status?: 'active' | 'completed' | 'failed'
          start_date?: string
          end_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          description?: string
          type?: 'daily' | 'weekly' | 'monthly' | 'special'
          progress?: number
          total?: number
          days_left?: number | null
          reward?: string | null
          status?: 'active' | 'completed' | 'failed'
          start_date?: string
          end_date?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      missions: {
        Row: {
          id: string
          user_id: string
          title: string
          description: string
          progress: number
          icon_type: 'target' | 'trophy' | 'book'
          target_books: Json
          target_tags: Json
          start_date: string
          end_date: string | null
          status: 'active' | 'completed' | 'paused'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          description: string
          progress?: number
          icon_type: 'target' | 'trophy' | 'book'
          target_books?: Json
          target_tags?: Json
          start_date?: string
          end_date?: string | null
          status?: 'active' | 'completed' | 'paused'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          description?: string
          progress?: number
          icon_type?: 'target' | 'trophy' | 'book'
          target_books?: Json
          target_tags?: Json
          start_date?: string
          end_date?: string | null
          status?: 'active' | 'completed' | 'paused'
          created_at?: string
          updated_at?: string
        }
      }
      reading_activities: {
        Row: {
          id: string
          user_id: string
          book_id: string
          type: 'started' | 'finished' | 'highlight' | 'tagged' | 'progress_update' | 'challenge_completed' | 'mission_completed'
          details: Json
          timestamp: string
        }
        Insert: {
          id?: string
          user_id: string
          book_id: string
          type: 'started' | 'finished' | 'highlight' | 'tagged' | 'progress_update' | 'challenge_completed' | 'mission_completed'
          details?: Json
          timestamp?: string
        }
        Update: {
          id?: string
          user_id?: string
          book_id?: string
          type?: 'started' | 'finished' | 'highlight' | 'tagged' | 'progress_update' | 'challenge_completed' | 'mission_completed'
          details?: Json
          timestamp?: string
        }
      }
      reading_sessions: {
        Row: {
          id: string
          user_id: string
          book_id: string
          start_time: string
          end_time: string | null
          pages_read: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          book_id: string
          start_time: string
          end_time?: string | null
          pages_read?: number
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          book_id?: string
          start_time?: string
          end_time?: string | null
          pages_read?: number
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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