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
      agent_monthly_usage: {
        Row: {
          agent_id: string
          chat_count: number
          ingestion_count: number
          updated_at: string
          year_month: string
        }
        Insert: {
          agent_id: string
          chat_count?: number
          ingestion_count?: number
          updated_at?: string
          year_month: string
        }
        Update: {
          agent_id?: string
          chat_count?: number
          ingestion_count?: number
          updated_at?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_monthly_usage_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_note_chunks: {
        Row: {
          agent_id: string
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          id: string
          note_id: string
        }
        Insert: {
          agent_id: string
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          note_id: string
        }
        Update: {
          agent_id?: string
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_note_chunks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_note_chunks_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "agent_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_notes: {
        Row: {
          agent_id: string
          contact_id: string | null
          content: string | null
          created_at: string
          document_metadata_id: string | null
          id: string
          is_active: boolean
          metadata: Json | null
          policy_id: string | null
          source_type: string
        }
        Insert: {
          agent_id: string
          contact_id?: string | null
          content?: string | null
          created_at?: string
          document_metadata_id?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          policy_id?: string | null
          source_type: string
        }
        Update: {
          agent_id?: string
          contact_id?: string | null
          content?: string | null
          created_at?: string
          document_metadata_id?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          policy_id?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_notes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notes_document_metadata_id_fkey"
            columns: ["document_metadata_id"]
            isOneToOne: false
            referencedRelation: "document_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_notes_policy_id_fkey"
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
          plan_id: string | null
          promo_code_used: string | null
          subscription_expires_at: string | null
          subscription_status: string
          trial_ends_at: string | null
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
          plan_id?: string | null
          promo_code_used?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
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
          plan_id?: string | null
          promo_code_used?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_agents_promo_code"
            columns: ["promo_code_used"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
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
      ai_ingestion_usage: {
        Row: {
          agent_id: string
          completion_tokens: number
          created_at: string
          document_metadata_id: string | null
          id: string
          item_count: number | null
          model_name: string
          operation: string
          prompt_tokens: number
          session_id: string | null
          total_tokens: number
        }
        Insert: {
          agent_id: string
          completion_tokens?: number
          created_at?: string
          document_metadata_id?: string | null
          id?: string
          item_count?: number | null
          model_name: string
          operation: string
          prompt_tokens?: number
          session_id?: string | null
          total_tokens?: number
        }
        Update: {
          agent_id?: string
          completion_tokens?: number
          created_at?: string
          document_metadata_id?: string | null
          id?: string
          item_count?: number | null
          model_name?: string
          operation?: string
          prompt_tokens?: number
          session_id?: string | null
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_ingestion_usage_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_ingestion_usage_document_metadata_id_fkey"
            columns: ["document_metadata_id"]
            isOneToOne: false
            referencedRelation: "document_metadata"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_ingestion_usage_model_name_fkey"
            columns: ["model_name"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["model_name"]
          },
          {
            foreignKeyName: "ai_ingestion_usage_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_models: {
        Row: {
          display_name: string | null
          input_cost_per_1m: number
          is_active: boolean
          model_name: string
          output_cost_per_1m: number
          provider: string
        }
        Insert: {
          display_name?: string | null
          input_cost_per_1m?: number
          is_active?: boolean
          model_name: string
          output_cost_per_1m?: number
          provider: string
        }
        Update: {
          display_name?: string | null
          input_cost_per_1m?: number
          is_active?: boolean
          model_name?: string
          output_cost_per_1m?: number
          provider?: string
        }
        Relationships: []
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
          embedding_count: number
          embedding_model_name: string | null
          embedding_total_tokens: number
          extraction_completion_tokens: number
          extraction_prompt_tokens: number
          extraction_total_tokens: number
          history: Json | null
          id: string
          is_billable: boolean
          metadata: Json | null
          model_name: string | null
          prompt_tokens: number
          status: string
          total_tokens: number
          trigger_message: string | null
          type: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          completion_tokens?: number
          created_at?: string
          embedding_count?: number
          embedding_model_name?: string | null
          embedding_total_tokens?: number
          extraction_completion_tokens?: number
          extraction_prompt_tokens?: number
          extraction_total_tokens?: number
          history?: Json | null
          id?: string
          is_billable?: boolean
          metadata?: Json | null
          model_name?: string | null
          prompt_tokens?: number
          status?: string
          total_tokens?: number
          trigger_message?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          completion_tokens?: number
          created_at?: string
          embedding_count?: number
          embedding_model_name?: string | null
          embedding_total_tokens?: number
          extraction_completion_tokens?: number
          extraction_prompt_tokens?: number
          extraction_total_tokens?: number
          history?: Json | null
          id?: string
          is_billable?: boolean
          metadata?: Json | null
          model_name?: string | null
          prompt_tokens?: number
          status?: string
          total_tokens?: number
          trigger_message?: string | null
          type?: string
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
          {
            foreignKeyName: "ai_sessions_embedding_model_name_fkey"
            columns: ["embedding_model_name"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["model_name"]
          },
          {
            foreignKeyName: "ai_sessions_model_name_fkey"
            columns: ["model_name"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["model_name"]
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
          ingestion_type: string
          mime_type: string
          raw_extraction: Json | null
          storage_path: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          extracted_at?: string | null
          file_name: string
          id?: string
          ingestion_type?: string
          mime_type?: string
          raw_extraction?: Json | null
          storage_path: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          extracted_at?: string | null
          file_name?: string
          id?: string
          ingestion_type?: string
          mime_type?: string
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
        ]
      }
      error_logs: {
        Row: {
          agent_id: string | null
          created_at: string
          error_message: string
          error_type: string
          id: string
          metadata: Json | null
          request_method: string | null
          request_path: string | null
          stack_trace: string | null
          status_code: number
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          error_message: string
          error_type: string
          id?: string
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          stack_trace?: string | null
          status_code: number
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          error_message?: string
          error_type?: string
          id?: string
          metadata?: Json | null
          request_method?: string | null
          request_path?: string | null
          stack_trace?: string | null
          status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
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
      promo_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          first_month_discount_pct: number
          id: string
          is_active: boolean
          max_uses: number | null
          trial_days: number
          used_count: number
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          first_month_discount_pct?: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          trial_days?: number
          used_count?: number
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          first_month_discount_pct?: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          trial_days?: number
          used_count?: number
        }
        Relationships: []
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
      subscription_plans: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          limits: Json
          name: string
          price_mxn: number
          price_usd: number
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          limits: Json
          name: string
          price_mxn: number
          price_usd: number
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          limits?: Json
          name?: string
          price_mxn?: number
          price_usd?: number
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_promo_code: {
        Args: { p_agent_id: string; p_code: string }
        Returns: Json
      }
      decrement_monthly_usage: {
        Args: { p_agent_id: string; p_field: string }
        Returns: undefined
      }
      increment_monthly_usage: {
        Args: { p_agent_id: string; p_field: string }
        Returns: Json
      }
      search_agent_note_chunks: {
        Args: {
          p_agent_id: string
          p_match_count?: number
          p_match_threshold?: number
          p_query_embedding: string
        }
        Returns: {
          chunk_id: string
          contact_id: string
          content: string
          metadata: Json
          note_id: string
          policy_id: string
          similarity: number
          source_type: string
        }[]
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

