export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_notes_vectors: {
        Row: {
          agent_id: string
          contact_id: string | null
          content: string
          created_at: string
          embedding: string | null
          id: string
          metadata: Json | null
          policy_id: string | null
        }
        Insert: {
          agent_id: string
          contact_id?: string | null
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          policy_id?: string | null
        }
        Update: {
          agent_id?: string
          contact_id?: string | null
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_notes_vectors_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notes_vectors_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notes_vectors_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_chat_messages: {
        Row: {
          agent_id: string
          completion_tokens: number
          content: string | null
          created_at: string
          id: string
          prompt_tokens: number
          role: string
          session_id: string
          total_tokens: number
        }
        Insert: {
          agent_id: string
          completion_tokens?: number
          content?: string | null
          created_at?: string
          id?: string
          prompt_tokens?: number
          role: string
          session_id: string
          total_tokens?: number
        }
        Update: {
          agent_id?: string
          completion_tokens?: number
          content?: string | null
          created_at?: string
          id?: string
          prompt_tokens?: number
          role?: string
          session_id?: string
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_pending_tasks: {
        Row: {
          agent_id: string
          cancellation_reason: string | null
          created_at: string
          id: string
          payload: Json
          session_id: string
          status: string
          task_type: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          cancellation_reason?: string | null
          created_at?: string
          id?: string
          payload: Json
          session_id: string
          status?: string
          task_type: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          cancellation_reason?: string | null
          created_at?: string
          id?: string
          payload?: Json
          session_id?: string
          status?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_pending_tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_tasks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_sessions: {
        Row: {
          agent_id: string
          completion_tokens: number
          created_at: string
          history: Json | null
          id: string
          prompt_tokens: number
          status: string
          total_tokens: number
          trigger_message: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          completion_tokens?: number
          created_at?: string
          history?: Json | null
          id?: string
          prompt_tokens?: number
          status?: string
          total_tokens?: number
          trigger_message?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          completion_tokens?: number
          created_at?: string
          history?: Json | null
          id?: string
          prompt_tokens?: number
          status?: string
          total_tokens?: number
          trigger_message?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      beneficiaries: {
        Row: {
          created_at: string
          full_name: string
          id: string
          percentage: number | null
          policy_id: string
          relationship: string | null
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          percentage?: number | null
          policy_id: string
          relationship?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          percentage?: number | null
          policy_id?: string
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "beneficiaries_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          agent_id: string
          code: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          agent_id: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          short_name: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          short_name?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          short_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carriers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          address: string | null
          agent_id: string
          birthdate: string | null
          created_at: string
          curp: string | null
          deleted_at: string | null
          email: string | null
          external_referrer_source: string | null
          full_name: string
          id: string
          is_active: boolean
          notes: string | null
          occupation: string | null
          phone: string | null
          referred_by_id: string | null
          rfc: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          agent_id: string
          birthdate?: string | null
          created_at?: string
          curp?: string | null
          deleted_at?: string | null
          email?: string | null
          external_referrer_source?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          notes?: string | null
          occupation?: string | null
          phone?: string | null
          referred_by_id?: string | null
          rfc?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          agent_id?: string
          birthdate?: string | null
          created_at?: string
          curp?: string | null
          deleted_at?: string | null
          email?: string | null
          external_referrer_source?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          occupation?: string | null
          phone?: string | null
          referred_by_id?: string | null
          rfc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_referred_by_id_fkey"
            columns: ["referred_by_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
        }
        Relationships: []
      }
      document_metadata: {
        Row: {
          agent_id: string
          created_at: string
          extracted_at: string | null
          file_name: string
          id: string
          mime_type: string
          policy_id: string | null
          raw_extraction: Json | null
          storage_path: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          extracted_at?: string | null
          file_name: string
          id?: string
          mime_type?: string
          policy_id?: string | null
          raw_extraction?: Json | null
          storage_path: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          extracted_at?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          policy_id?: string | null
          raw_extraction?: Json | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_metadata_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_metadata_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_roles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      payment_frequencies: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          months: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          months: number
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          months?: number
          name?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      policies: {
        Row: {
          agent_id: string
          contact_id: string
          created_at: string
          currency_id: string
          deleted_at: string | null
          end_date: string | null
          id: string
          is_active: boolean
          next_payment_date: string | null
          notes: string | null
          payment_frequency_id: string | null
          payment_method_id: string | null
          policy_number: string | null
          premium: number | null
          product_id: string
          renewal_date: string | null
          start_date: string | null
          status_id: string
          sum_insured: number | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          contact_id: string
          created_at?: string
          currency_id: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          next_payment_date?: string | null
          notes?: string | null
          payment_frequency_id?: string | null
          payment_method_id?: string | null
          policy_number?: string | null
          premium?: number | null
          product_id: string
          renewal_date?: string | null
          start_date?: string | null
          status_id: string
          sum_insured?: number | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          contact_id?: string
          created_at?: string
          currency_id?: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          next_payment_date?: string | null
          notes?: string | null
          payment_frequency_id?: string | null
          payment_method_id?: string | null
          policy_number?: string | null
          premium?: number | null
          product_id?: string
          renewal_date?: string | null
          start_date?: string | null
          status_id?: string
          sum_insured?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_currency_id_fkey"
            columns: ["currency_id"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_payment_frequency_id_fkey"
            columns: ["payment_frequency_id"]
            isOneToOne: false
            referencedRelation: "payment_frequencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policies_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "policy_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_participants: {
        Row: {
          birthdate: string | null
          contact_id: string | null
          created_at: string
          full_name: string | null
          id: string
          policy_id: string
          relationship: string | null
          role_id: string
        }
        Insert: {
          birthdate?: string | null
          contact_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          policy_id: string
          relationship?: string | null
          role_id: string
        }
        Update: {
          birthdate?: string | null
          contact_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          policy_id?: string
          relationship?: string | null
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_participants_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_participants_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "participant_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_statuses: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          agent_id: string
          branch_id: string
          carrier_id: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          branch_id: string
          carrier_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          branch_id?: string
          carrier_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_settings: {
        Row: {
          agent_id: string
          created_at: string
          days_before: number
          id: string
          is_active: boolean
          reminder_type_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          days_before?: number
          id?: string
          is_active?: boolean
          reminder_type_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          days_before?: number
          id?: string
          is_active?: boolean
          reminder_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_settings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_settings_reminder_type_id_fkey"
            columns: ["reminder_type_id"]
            isOneToOne: false
            referencedRelation: "reminder_types"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_types: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          agent_id: string
          contact_id: string | null
          created_at: string
          description: string | null
          due_date: string
          id: string
          is_done: boolean
          notified_at: string | null
          policy_id: string | null
          title: string
          type_id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          contact_id?: string | null
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          is_done?: boolean
          notified_at?: string | null
          policy_id?: string | null
          title: string
          type_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          contact_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          is_done?: boolean
          notified_at?: string | null
          policy_id?: string | null
          title?: string
          type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "reminder_types"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_session_usage: {
        Args: {
          p_completion_tokens: number
          p_prompt_tokens: number
          p_session_id: string
          p_total_tokens: number
        }
        Returns: undefined
      }
      search_agent_notes: {
        Args: {
          p_agent_id: string
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
        }
        Returns: {
          contact_id: string
          content: string
          id: string
          metadata: Json
          policy_id: string
          similarity: number
        }[]
      }
      search_catalog:
        | {
            Args: {
              p_query: string
              p_table_name: string
              p_threshold?: number
            }
            Returns: {
              id: string
              name: string
              similarity: number
            }[]
          }
        | {
            Args: {
              p_agent_id?: string
              p_query: string
              p_table_name: string
              p_threshold?: number
            }
            Returns: {
              id: string
              name: string
              similarity: number
            }[]
          }
      search_contacts: {
        Args: { p_agent_id: string; p_query: string; p_threshold?: number }
        Returns: {
          email: string
          full_name: string
          id: string
          phone: string
          similarity: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

