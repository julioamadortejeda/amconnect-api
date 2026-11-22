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
      agent_device_tokens: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          platform: string
          token: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          platform: string
          token: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          platform?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_device_tokens_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
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
            foreignKeyName: "agent_note_chunks_note_id_same_agent_fkey"
            columns: ["agent_id", "note_id"]
            isOneToOne: false
            referencedRelation: "agent_notes"
            referencedColumns: ["agent_id", "id"]
          },
        ]
      }
      agent_notes: {
        Row: {
          agent_id: string
          contact_id: string | null
          content: string | null
          created_at: string
          discard_reason: string | null
          document_metadata_id: string | null
          id: string
          is_active: boolean
          note_origin: string
          policy_id: string | null
          reminder_id: string | null
          source_type: string
          summary: string | null
        }
        Insert: {
          agent_id: string
          contact_id?: string | null
          content?: string | null
          created_at?: string
          discard_reason?: string | null
          document_metadata_id?: string | null
          id?: string
          is_active?: boolean
          note_origin?: string
          policy_id?: string | null
          reminder_id?: string | null
          source_type: string
          summary?: string | null
        }
        Update: {
          agent_id?: string
          contact_id?: string | null
          content?: string | null
          created_at?: string
          discard_reason?: string | null
          document_metadata_id?: string | null
          id?: string
          is_active?: boolean
          note_origin?: string
          policy_id?: string | null
          reminder_id?: string | null
          source_type?: string
          summary?: string | null
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
            foreignKeyName: "agent_notes_contact_id_same_agent_fkey"
            columns: ["agent_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "agent_notes_document_metadata_id_same_agent_fkey"
            columns: ["agent_id", "document_metadata_id"]
            isOneToOne: false
            referencedRelation: "document_metadata"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "agent_notes_policy_id_same_agent_fkey"
            columns: ["agent_id", "policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "agent_notes_reminder_id_same_agent_fkey"
            columns: ["agent_id", "reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["agent_id", "id"]
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
          locale: string | null
          phone: string | null
          plan: string
          plan_id: string | null
          privacy_accepted_at: string | null
          privacy_accepted_version: string | null
          promo_code_used: string | null
          subscription_expires_at: string | null
          subscription_status: string
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          locale?: string | null
          phone?: string | null
          plan?: string
          plan_id?: string | null
          privacy_accepted_at?: string | null
          privacy_accepted_version?: string | null
          promo_code_used?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          locale?: string | null
          phone?: string | null
          plan?: string
          plan_id?: string | null
          privacy_accepted_at?: string | null
          privacy_accepted_version?: string | null
          promo_code_used?: string | null
          subscription_expires_at?: string | null
          subscription_status?: string
          timezone?: string | null
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
          content: string | null
          created_at: string
          id: string
          interaction_id: string | null
          role: string
          session_id: string
        }
        Insert: {
          agent_id: string
          content?: string | null
          created_at?: string
          id?: string
          interaction_id?: string | null
          role: string
          session_id: string
        }
        Update: {
          agent_id?: string
          content?: string | null
          created_at?: string
          id?: string
          interaction_id?: string | null
          role?: string
          session_id?: string
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
            foreignKeyName: "ai_chat_messages_session_id_same_agent_fkey"
            columns: ["agent_id", "session_id"]
            isOneToOne: false
            referencedRelation: "ai_sessions"
            referencedColumns: ["agent_id", "id"]
          },
        ]
      }
      ai_models: {
        Row: {
          audio_input_cost_per_1m: number | null
          audio_output_cost_per_1m: number | null
          cache_read_cost_per_1m: number
          display_name: string | null
          input_cost_per_1m: number
          is_active: boolean
          model_name: string
          output_cost_per_1m: number
          provider: string
        }
        Insert: {
          audio_input_cost_per_1m?: number | null
          audio_output_cost_per_1m?: number | null
          cache_read_cost_per_1m?: number
          display_name?: string | null
          input_cost_per_1m?: number
          is_active?: boolean
          model_name: string
          output_cost_per_1m?: number
          provider: string
        }
        Update: {
          audio_input_cost_per_1m?: number | null
          audio_output_cost_per_1m?: number | null
          cache_read_cost_per_1m?: number
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
            foreignKeyName: "ai_pending_tasks_session_id_same_agent_fkey"
            columns: ["agent_id", "session_id"]
            isOneToOne: false
            referencedRelation: "ai_sessions"
            referencedColumns: ["agent_id", "id"]
          },
        ]
      }
      ai_sessions: {
        Row: {
          agent_id: string
          created_at: string
          duration_seconds: number | null
          embedding_model_name: string | null
          history: Json | null
          id: string
          is_billable: boolean
          last_interaction_id: string | null
          metadata: Json | null
          model_name: string | null
          status: string
          trigger_message: string | null
          tts_completion_tokens: number
          tts_model_name: string | null
          tts_prompt_tokens: number
          tts_total_tokens: number
          type: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          duration_seconds?: number | null
          embedding_model_name?: string | null
          history?: Json | null
          id?: string
          is_billable?: boolean
          last_interaction_id?: string | null
          metadata?: Json | null
          model_name?: string | null
          status?: string
          trigger_message?: string | null
          tts_completion_tokens?: number
          tts_model_name?: string | null
          tts_prompt_tokens?: number
          tts_total_tokens?: number
          type?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          duration_seconds?: number | null
          embedding_model_name?: string | null
          history?: Json | null
          id?: string
          is_billable?: boolean
          last_interaction_id?: string | null
          metadata?: Json | null
          model_name?: string | null
          status?: string
          trigger_message?: string | null
          tts_completion_tokens?: number
          tts_model_name?: string | null
          tts_prompt_tokens?: number
          tts_total_tokens?: number
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
          {
            foreignKeyName: "ai_sessions_tts_model_name_fkey"
            columns: ["tts_model_name"]
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
      client_commitments: {
        Row: {
          agent_id: string
          contact_id: string | null
          created_at: string
          deleted_at: string | null
          due_from: string | null
          due_to: string | null
          id: string
          is_active: boolean
          label: string
          quote: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by_session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          due_from?: string | null
          due_to?: string | null
          id?: string
          is_active?: boolean
          label: string
          quote: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          due_from?: string | null
          due_to?: string | null
          id?: string
          is_active?: boolean
          label?: string
          quote?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by_session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_commitments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_commitments_contact_id_same_agent_fkey"
            columns: ["agent_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["agent_id", "id"]
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
          is_prospect: boolean
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
          is_prospect?: boolean
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
          is_prospect?: boolean
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
            foreignKeyName: "contacts_referred_by_id_same_agent_fkey"
            columns: ["agent_id", "referred_by_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["agent_id", "id"]
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
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      payment_frequencies: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          months: number
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          months: number
          name: string
        }
        Update: {
          code?: string
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
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
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
          coinsurance: string | null
          contact_id: string
          created_at: string
          currency_id: string
          deductible: string | null
          deleted_at: string | null
          end_date: string | null
          id: string
          insured_item: string | null
          is_active: boolean
          next_payment_date: string | null
          notes: string | null
          payment_frequency_id: string | null
          payment_method_id: string | null
          policy_number: string | null
          policy_version: string | null
          premium: number | null
          product_id: string
          renewal_date: string | null
          seniority_date: string | null
          start_date: string | null
          status_id: string
          sum_insured: number | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          coinsurance?: string | null
          contact_id: string
          created_at?: string
          currency_id: string
          deductible?: string | null
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          insured_item?: string | null
          is_active?: boolean
          next_payment_date?: string | null
          notes?: string | null
          payment_frequency_id?: string | null
          payment_method_id?: string | null
          policy_number?: string | null
          policy_version?: string | null
          premium?: number | null
          product_id: string
          renewal_date?: string | null
          seniority_date?: string | null
          start_date?: string | null
          status_id: string
          sum_insured?: number | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          coinsurance?: string | null
          contact_id?: string
          created_at?: string
          currency_id?: string
          deductible?: string | null
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          insured_item?: string | null
          is_active?: boolean
          next_payment_date?: string | null
          notes?: string | null
          payment_frequency_id?: string | null
          payment_method_id?: string | null
          policy_number?: string | null
          policy_version?: string | null
          premium?: number | null
          product_id?: string
          renewal_date?: string | null
          seniority_date?: string | null
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
            foreignKeyName: "policies_contact_id_same_agent_fkey"
            columns: ["agent_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["agent_id", "id"]
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
            foreignKeyName: "policies_product_id_same_agent_fkey"
            columns: ["agent_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["agent_id", "id"]
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
      privacy_consents: {
        Row: {
          accepted_at: string
          accepted_notice: boolean
          accepted_sensitive: boolean
          agent_id: string
          app_version: string | null
          id: string
          ip: unknown
          locale: string | null
          platform: string | null
          user_agent: string | null
          version: string
        }
        Insert: {
          accepted_at?: string
          accepted_notice: boolean
          accepted_sensitive: boolean
          agent_id: string
          app_version?: string | null
          id?: string
          ip?: unknown
          locale?: string | null
          platform?: string | null
          user_agent?: string | null
          version: string
        }
        Update: {
          accepted_at?: string
          accepted_notice?: boolean
          accepted_sensitive?: boolean
          agent_id?: string
          app_version?: string | null
          id?: string
          ip?: unknown
          locale?: string | null
          platform?: string | null
          user_agent?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_consents_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "products_branch_id_same_agent_fkey"
            columns: ["agent_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "products_carrier_id_same_agent_fkey"
            columns: ["agent_id", "carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["agent_id", "id"]
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
      rate_limit_buckets: {
        Row: {
          agent_id: string
          bucket: string
          request_count: number
          window_seconds: number
          window_start: string
        }
        Insert: {
          agent_id: string
          bucket: string
          request_count?: number
          window_seconds: number
          window_start: string
        }
        Update: {
          agent_id?: string
          bucket?: string
          request_count?: number
          window_seconds?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_buckets_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      recall_searches: {
        Row: {
          agent_id: string
          created_at: string
          embedding: string
          id: string
          query: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          embedding: string
          id?: string
          query: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          embedding?: string
          id?: string
          query?: string
        }
        Relationships: [
          {
            foreignKeyName: "recall_searches_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_comments: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          id: string
          reminder_id: string
        }
        Insert: {
          agent_id: string
          content: string
          created_at?: string
          id?: string
          reminder_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          id?: string
          reminder_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_comments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_comments_reminder_id_same_agent_fkey"
            columns: ["agent_id", "reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["agent_id", "id"]
          },
        ]
      }
      reminder_notifications: {
        Row: {
          agent_id: string
          due_date_at_send: string
          id: string
          reminder_id: string
          sent_at: string
        }
        Insert: {
          agent_id: string
          due_date_at_send: string
          id?: string
          reminder_id: string
          sent_at?: string
        }
        Update: {
          agent_id?: string
          due_date_at_send?: string
          id?: string
          reminder_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_notifications_reminder_id_same_agent_fkey"
            columns: ["agent_id", "reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["agent_id", "id"]
          },
        ]
      }
      reminder_push_deliveries: {
        Row: {
          attempts: number
          claimed_at: string | null
          due_date: string
          gave_up_at: string | null
          last_error: string | null
          reminder_id: string
          sent_at: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          due_date: string
          gave_up_at?: string | null
          last_error?: string | null
          reminder_id: string
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          due_date?: string
          gave_up_at?: string | null
          last_error?: string | null
          reminder_id?: string
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_push_deliveries_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: true
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_settings: {
        Row: {
          agent_id: string
          branch_id: string | null
          created_at: string
          days_before: number
          id: string
          is_active: boolean
          reminder_type_id: string
        }
        Insert: {
          agent_id: string
          branch_id?: string | null
          created_at?: string
          days_before?: number
          id?: string
          is_active?: boolean
          reminder_type_id: string
        }
        Update: {
          agent_id?: string
          branch_id?: string | null
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
            foreignKeyName: "reminder_settings_branch_id_same_agent_fkey"
            columns: ["agent_id", "branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["agent_id", "id"]
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
      reminder_statuses: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
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
          deleted_at: string | null
          description: string | null
          due_date: string
          id: string
          is_active: boolean
          notified_at: string | null
          occurrence_date: string | null
          policy_id: string | null
          status_id: string
          template_data: Json | null
          title: string
          title_template: string | null
          type_id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date: string
          id?: string
          is_active?: boolean
          notified_at?: string | null
          occurrence_date?: string | null
          policy_id?: string | null
          status_id: string
          template_data?: Json | null
          title: string
          title_template?: string | null
          type_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string
          id?: string
          is_active?: boolean
          notified_at?: string | null
          occurrence_date?: string | null
          policy_id?: string | null
          status_id?: string
          template_data?: Json | null
          title?: string
          title_template?: string | null
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
            foreignKeyName: "reminders_contact_id_same_agent_fkey"
            columns: ["agent_id", "contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "reminders_policy_id_same_agent_fkey"
            columns: ["agent_id", "policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "reminders_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "reminder_statuses"
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
      search_stopwords: {
        Row: {
          created_at: string
          language: string
          word: string
        }
        Insert: {
          created_at?: string
          language: string
          word: string
        }
        Update: {
          created_at?: string
          language?: string
          word?: string
        }
        Relationships: []
      }
      search_synonyms: {
        Row: {
          country: string | null
          created_at: string
          domain: string
          expands_to: string
          id: string
          language: string
          term: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          domain: string
          expands_to: string
          id?: string
          language: string
          term: string
        }
        Update: {
          country?: string | null
          created_at?: string
          domain?: string
          expands_to?: string
          id?: string
          language?: string
          term?: string
        }
        Relationships: []
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
      system_prompts: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          prompt: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          prompt: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      tokens_usage: {
        Row: {
          agent_id: string
          audio_completion_tokens: number
          audio_prompt_tokens: number
          cached_tokens: number
          completion_tokens: number
          created_at: string
          document_metadata_id: string | null
          id: string
          model_name: string
          note_id: string | null
          prompt_tokens: number
          session_id: string | null
          source: string
          text_completion_tokens: number
          text_prompt_tokens: number
          thoughts_tokens: number
          total_tokens: number
        }
        Insert: {
          agent_id: string
          audio_completion_tokens?: number
          audio_prompt_tokens?: number
          cached_tokens?: number
          completion_tokens?: number
          created_at?: string
          document_metadata_id?: string | null
          id?: string
          model_name: string
          note_id?: string | null
          prompt_tokens?: number
          session_id?: string | null
          source: string
          text_completion_tokens?: number
          text_prompt_tokens?: number
          thoughts_tokens?: number
          total_tokens?: number
        }
        Update: {
          agent_id?: string
          audio_completion_tokens?: number
          audio_prompt_tokens?: number
          cached_tokens?: number
          completion_tokens?: number
          created_at?: string
          document_metadata_id?: string | null
          id?: string
          model_name?: string
          note_id?: string | null
          prompt_tokens?: number
          session_id?: string | null
          source?: string
          text_completion_tokens?: number
          text_prompt_tokens?: number
          thoughts_tokens?: number
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "tokens_usage_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tokens_usage_document_metadata_id_same_agent_fkey"
            columns: ["agent_id", "document_metadata_id"]
            isOneToOne: false
            referencedRelation: "document_metadata"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "tokens_usage_model_name_fkey"
            columns: ["model_name"]
            isOneToOne: false
            referencedRelation: "ai_models"
            referencedColumns: ["model_name"]
          },
          {
            foreignKeyName: "tokens_usage_note_id_same_agent_fkey"
            columns: ["agent_id", "note_id"]
            isOneToOne: false
            referencedRelation: "agent_notes"
            referencedColumns: ["agent_id", "id"]
          },
          {
            foreignKeyName: "tokens_usage_session_id_same_agent_fkey"
            columns: ["agent_id", "session_id"]
            isOneToOne: false
            referencedRelation: "ai_sessions"
            referencedColumns: ["agent_id", "id"]
          },
        ]
      }
      usage_charges: {
        Row: {
          agent_id: string
          created_at: string
          field: string
          id: string
          refunded_at: string | null
          year_month: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          field: string
          id?: string
          refunded_at?: string | null
          year_month: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          field?: string
          id?: string
          refunded_at?: string | null
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_charges_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
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
      assert_usage_caller: { Args: { p_agent_id: string }; Returns: undefined }
      backfill_reminder_title_templates: {
        Args: never
        Returns: {
          contacts_linked: number
          templates_set: number
        }[]
      }
      claim_device_token: {
        Args: { p_platform: string; p_token: string }
        Returns: {
          agent_id: string
          created_at: string
          id: string
          platform: string
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_device_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_due_reminders: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_max_attempts?: number
        }
        Returns: {
          agent_id: string
          attempts: number
          description: string
          due_date: string
          id: string
          title: string
        }[]
      }
      consume_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: Json
      }
      cron_check_due_reminders: { Args: never; Returns: undefined }
      cron_generate_due_reminders: { Args: never; Returns: undefined }
      daitch_mokotoff: { Args: { "": string }; Returns: string[] }
      dmetaphone: { Args: { "": string }; Returns: string }
      dmetaphone_alt: { Args: { "": string }; Returns: string }
      get_notification_secret: { Args: never; Returns: string }
      get_supabase_url: { Args: never; Returns: string }
      get_vault_secret: { Args: { p_name: string }; Returns: string }
      immutable_unaccent: { Args: { p_text: string }; Returns: string }
      increment_monthly_usage: {
        Args: { p_agent_id: string; p_field: string }
        Returns: Json
      }
      insert_agent_note_with_chunks: {
        Args: {
          p_agent_id: string
          p_chunks: Json
          p_contact_id: string
          p_content: string
          p_document_metadata_id: string
          p_note_origin: string
          p_policy_id: string
          p_reminder_id: string
          p_source_type: string
          p_summary: string
        }
        Returns: string
      }
      insert_generated_reminders: {
        Args: { p_rows: Json }
        Returns: {
          due_date: string
          id: string
          is_active: boolean
          is_new: boolean
          occurrence_date: string
          title: string
          type_id: string
        }[]
      }
      normalize_search_text: { Args: { p_text: string }; Returns: string }
      purge_rate_limit_buckets: { Args: never; Returns: number }
      recall_tsquery: { Args: { p_query: string }; Returns: unknown }
      record_privacy_consent: {
        Args: {
          p_accepted_notice: boolean
          p_accepted_sensitive: boolean
          p_app_version: string
          p_ip: string
          p_locale: string
          p_platform: string
          p_user_agent: string
          p_version: string
        }
        Returns: undefined
      }
      refund_usage_charge: { Args: { p_charge_id: string }; Returns: boolean }
      search_agent_note_chunks: {
        Args: {
          p_agent_id: string
          p_contact_id?: string
          p_match_count?: number
          p_match_threshold?: number
          p_policy_id?: string
          p_query_embedding: string
          p_reminder_id?: string
        }
        Returns: {
          chunk_id: string
          contact_id: string
          content: string
          created_at: string
          note_id: string
          policy_id: string
          reminder_id: string
          similarity: number
          source_type: string
        }[]
      }
      search_agent_note_chunks_exact: {
        Args: {
          p_agent_id: string
          p_contact_id?: string
          p_match_count?: number
          p_match_threshold?: number
          p_note_id?: string
          p_policy_id?: string
          p_query_embedding: string
          p_reminder_id?: string
          p_source_types?: string[]
        }
        Returns: {
          chunk_id: string
          contact_id: string
          content: string
          created_at: string
          note_id: string
          policy_id: string
          reminder_id: string
          similarity: number
          source_type: string
        }[]
      }
      search_agent_note_chunks_text: {
        Args: {
          p_agent_id: string
          p_contact_id?: string
          p_match_count?: number
          p_note_id?: string
          p_policy_id?: string
          p_query: string
          p_reminder_id?: string
          p_source_types?: string[]
        }
        Returns: {
          chunk_id: string
          contact_id: string
          content: string
          created_at: string
          note_id: string
          policy_id: string
          reminder_id: string
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
      search_commitment_ids: {
        Args: { p_agent_id: string; p_query: string; p_threshold?: number }
        Returns: string[]
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
      search_notes: {
        Args: { p_limit?: number; p_offset?: number; p_query?: string }
        Returns: {
          contact_id: string
          content: string
          created_at: string
          file_name: string
          full_name: string
          id: string
          policy_id: string
          source_type: string
          storage_path: string
          summary: string
        }[]
      }
      search_policy_ids: {
        Args: {
          p_agent_id: string
          p_contact_id?: string
          p_query: string
          p_threshold?: number
        }
        Returns: string[]
      }
      search_reminder_ids: {
        Args: { p_agent_id: string; p_query: string; p_threshold?: number }
        Returns: string[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soundex: { Args: { "": string }; Returns: string }
      text_soundex: { Args: { "": string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
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

