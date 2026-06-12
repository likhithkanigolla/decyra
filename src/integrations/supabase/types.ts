export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      adr_relationships: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          rel_type: Database["public"]["Enums"]["relationship_type"]
          source_adr_id: string
          target_adr_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          rel_type: Database["public"]["Enums"]["relationship_type"]
          source_adr_id: string
          target_adr_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          rel_type?: Database["public"]["Enums"]["relationship_type"]
          source_adr_id?: string
          target_adr_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "adr_relationships_source_adr_id_fkey"
            columns: ["source_adr_id"]
            isOneToOne: false
            referencedRelation: "adrs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adr_relationships_target_adr_id_fkey"
            columns: ["target_adr_id"]
            isOneToOne: false
            referencedRelation: "adrs"
            referencedColumns: ["id"]
          },
        ]
      }
      adrs: {
        Row: {
          adr_number: number
          alternatives: string | null
          author_id: string
          consequences: string | null
          context: string | null
          created_at: string
          current_version: number
          decision: string | null
          design_changes: Json
          full_id: string
          id: string
          major_impacts: Json
          project_id: string
          references_data: Json
          status: Database["public"]["Enums"]["adr_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          adr_number: number
          alternatives?: string | null
          author_id: string
          consequences?: string | null
          context?: string | null
          created_at?: string
          current_version?: number
          decision?: string | null
          design_changes?: Json
          full_id: string
          id?: string
          major_impacts?: Json
          project_id: string
          references_data?: Json
          status?: Database["public"]["Enums"]["adr_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          adr_number?: number
          alternatives?: string | null
          author_id?: string
          consequences?: string | null
          context?: string | null
          created_at?: string
          current_version?: number
          decision?: string | null
          design_changes?: Json
          full_id?: string
          id?: string
          major_impacts?: Json
          project_id?: string
          references_data?: Json
          status?: Database["public"]["Enums"]["adr_status"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "adrs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          adr_id: string
          created_at: string
          decision: string
          id: string
          note: string | null
          user_id: string
        }
        Insert: {
          adr_id: string
          created_at?: string
          decision: string
          id?: string
          note?: string | null
          user_id: string
        }
        Update: {
          adr_id?: string
          created_at?: string
          decision?: string
          id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_adr_id_fkey"
            columns: ["adr_id"]
            isOneToOne: false
            referencedRelation: "adrs"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          adr_id: string
          body: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          adr_id: string
          body: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          adr_id?: string
          body?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_adr_id_fkey"
            columns: ["adr_id"]
            isOneToOne: false
            referencedRelation: "adrs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          adr_path: string | null
          adr_sequence: number
          branch: string | null
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          repo_url: string | null
          required_approvals: number
          updated_at: string
        }
        Insert: {
          adr_path?: string | null
          adr_sequence?: number
          branch?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          repo_url?: string | null
          required_approvals?: number
          updated_at?: string
        }
        Update: {
          adr_path?: string | null
          adr_sequence?: number
          branch?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          repo_url?: string | null
          required_approvals?: number
          updated_at?: string
        }
        Relationships: []
      }
      published_versions: {
        Row: {
          adr_id: string
          git_commit_hash: string | null
          id: string
          markdown: string
          published_at: string
          published_by: string
          version_number: number
        }
        Insert: {
          adr_id: string
          git_commit_hash?: string | null
          id?: string
          markdown: string
          published_at?: string
          published_by: string
          version_number: number
        }
        Update: {
          adr_id?: string
          git_commit_hash?: string | null
          id?: string
          markdown?: string
          published_at?: string
          published_by?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "published_versions_adr_id_fkey"
            columns: ["adr_id"]
            isOneToOne: false
            referencedRelation: "adrs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_project_role: {
        Args: {
          _project_id: string
          _role: Database["public"]["Enums"]["project_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      adr_status:
        | "draft"
        | "under_review"
        | "approved"
        | "published"
        | "superseded"
      app_role: "admin" | "member"
      project_role: "project_admin" | "engineer" | "intern"
      relationship_type:
        | "depends_on"
        | "related_to"
        | "supersedes"
        | "superseded_by"
        | "conflicts_with"
        | "affects"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      adr_status: [
        "draft",
        "under_review",
        "approved",
        "published",
        "superseded",
      ],
      app_role: ["admin", "member"],
      project_role: ["project_admin", "engineer", "intern"],
      relationship_type: [
        "depends_on",
        "related_to",
        "supersedes",
        "superseded_by",
        "conflicts_with",
        "affects",
      ],
    },
  },
} as const
