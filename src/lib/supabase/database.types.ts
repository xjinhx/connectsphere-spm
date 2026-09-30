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
      accessibility_features: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      client_organisations: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_request: {
        Row: {
          accessibility_notes: string | null
          accessibility_required: boolean | null
          assigned_at: string | null
          assigned_by: string | null
          clarification_note: string | null
          clarification_requested_at: string | null
          clarification_requested_by: string | null
          client_organisation_id: string | null
          coordinator_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          description: string | null
          equipment_required: boolean | null
          expected_attendance: number | null
          id: string
          name: string
          organiser_id: string
          preferred_location_id: string | null
          proposed_date: string | null
          purpose: string | null
          reference: string
          registration_required: boolean | null
          rejection_reason: string | null
          room_layout: string | null
          status: Database["public"]["Enums"]["event_request_status"]
          submitted_at: string | null
          technical_support_notes: string | null
          time_slots: string[] | null
          updated_at: string
        }
        Insert: {
          accessibility_notes?: string | null
          accessibility_required?: boolean | null
          assigned_at?: string | null
          assigned_by?: string | null
          clarification_note?: string | null
          clarification_requested_at?: string | null
          clarification_requested_by?: string | null
          client_organisation_id?: string | null
          coordinator_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          description?: string | null
          equipment_required?: boolean | null
          expected_attendance?: number | null
          id?: string
          name: string
          organiser_id: string
          preferred_location_id?: string | null
          proposed_date?: string | null
          purpose?: string | null
          reference?: string
          registration_required?: boolean | null
          rejection_reason?: string | null
          room_layout?: string | null
          status?: Database["public"]["Enums"]["event_request_status"]
          submitted_at?: string | null
          technical_support_notes?: string | null
          time_slots?: string[] | null
          updated_at?: string
        }
        Update: {
          accessibility_notes?: string | null
          accessibility_required?: boolean | null
          assigned_at?: string | null
          assigned_by?: string | null
          clarification_note?: string | null
          clarification_requested_at?: string | null
          clarification_requested_by?: string | null
          client_organisation_id?: string | null
          coordinator_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          description?: string | null
          equipment_required?: boolean | null
          expected_attendance?: number | null
          id?: string
          name?: string
          organiser_id?: string
          preferred_location_id?: string | null
          proposed_date?: string | null
          purpose?: string | null
          reference?: string
          registration_required?: boolean | null
          rejection_reason?: string | null
          room_layout?: string | null
          status?: Database["public"]["Enums"]["event_request_status"]
          submitted_at?: string | null
          technical_support_notes?: string | null
          time_slots?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_request_client_organisation_id_fkey"
            columns: ["client_organisation_id"]
            isOneToOne: false
            referencedRelation: "client_organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_request_preferred_location_id_fkey"
            columns: ["preferred_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_request_accessibility_features: {
        Row: {
          accessibility_feature_id: string
          event_request_id: string
        }
        Insert: {
          accessibility_feature_id: string
          event_request_id: string
        }
        Update: {
          accessibility_feature_id?: string
          event_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_request_accessibility_featu_accessibility_feature_id_fkey"
            columns: ["accessibility_feature_id"]
            isOneToOne: false
            referencedRelation: "accessibility_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_request_accessibility_features_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
      }
      event_request_clarification_round: {
        Row: {
          event_request_id: string
          id: string
          note: string
          requested_at: string
          requested_by: string
          responded_at: string | null
          responded_by: string | null
          response: string | null
          round_number: number
        }
        Insert: {
          event_request_id: string
          id?: string
          note: string
          requested_at: string
          requested_by: string
          responded_at?: string | null
          responded_by?: string | null
          response?: string | null
          round_number: number
        }
        Update: {
          event_request_id?: string
          id?: string
          note?: string
          requested_at?: string
          requested_by?: string
          responded_at?: string | null
          responded_by?: string | null
          response?: string | null
          round_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_request_clarification_round_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
      }
      event_request_coordinator_history: {
        Row: {
          assigned_at: string
          assigned_by: string
          coordinator_id: string
          event_request_id: string
          id: string
          replaced_at: string
          replaced_by: string
          replaced_by_coordinator_id: string
        }
        Insert: {
          assigned_at: string
          assigned_by: string
          coordinator_id: string
          event_request_id: string
          id?: string
          replaced_at?: string
          replaced_by: string
          replaced_by_coordinator_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          coordinator_id?: string
          event_request_id?: string
          id?: string
          replaced_at?: string
          replaced_by?: string
          replaced_by_coordinator_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_request_coordinator_history_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
      }
      event_request_equipment: {
        Row: {
          event_request_id: string
          item: string
          position: number
          quantity: number
        }
        Insert: {
          event_request_id: string
          item: string
          position: number
          quantity: number
        }
        Update: {
          event_request_id?: string
          item?: string
          position?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_request_equipment_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      locations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          client_organisation_id: string | null
          contact_number: string | null
          created_at: string
          full_name: string | null
          id: string
          roles: string[]
          updated_at: string
        }
        Insert: {
          client_organisation_id?: string | null
          contact_number?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          roles?: string[]
          updated_at?: string
        }
        Update: {
          client_organisation_id?: string | null
          contact_number?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          roles?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_client_organisation_id_fkey"
            columns: ["client_organisation_id"]
            isOneToOne: false
            referencedRelation: "client_organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_accessibility_features: {
        Row: {
          accessibility_feature_id: string
          venue_id: string
        }
        Insert: {
          accessibility_feature_id: string
          venue_id: string
        }
        Update: {
          accessibility_feature_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_accessibility_features_accessibility_feature_id_fkey"
            columns: ["accessibility_feature_id"]
            isOneToOne: false
            referencedRelation: "accessibility_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_accessibility_features_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_booking: {
        Row: {
          created_at: string
          event_request_id: string
          id: string
          status: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          event_request_id: string
          id?: string
          status?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          event_request_id?: string
          id?: string
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_booking_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_booking_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_capacity_notice: {
        Row: {
          coordinator_id: string | null
          created_at: string
          event_request_id: string
          expected_attendance: number
          id: string
          new_capacity: number
          previous_capacity: number
          venue_id: string
        }
        Insert: {
          coordinator_id?: string | null
          created_at?: string
          event_request_id: string
          expected_attendance: number
          id?: string
          new_capacity: number
          previous_capacity: number
          venue_id: string
        }
        Update: {
          coordinator_id?: string | null
          created_at?: string
          event_request_id?: string
          expected_attendance?: number
          id?: string
          new_capacity?: number
          previous_capacity?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_capacity_notice_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_capacity_notice_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_facilities: {
        Row: {
          facility_id: string
          venue_id: string
        }
        Insert: {
          facility_id: string
          venue_id: string
        }
        Update: {
          facility_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_facilities_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_facilities_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_layouts: {
        Row: {
          capacity: number
          layout: string
          venue_id: string
        }
        Insert: {
          capacity: number
          layout: string
          venue_id: string
        }
        Update: {
          capacity?: number
          layout?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_layouts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_unavailable_slot: {
        Row: {
          created_at: string
          date: string
          id: string
          reason: string
          slot: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          reason: string
          slot: string
          venue_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          reason?: string
          slot?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_unavailable_slot_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          created_at: string
          id: string
          is_retired: boolean
          location_id: string
          max_capacity: number
          name: string
          needs_setup_slot: boolean
          needs_turnaround_slot: boolean
          operating_slots: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_retired?: boolean
          location_id: string
          max_capacity: number
          name: string
          needs_setup_slot?: boolean
          needs_turnaround_slot?: boolean
          operating_slots?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_retired?: boolean
          location_id?: string
          max_capacity?: number
          name?: string
          needs_setup_slot?: boolean
          needs_turnaround_slot?: boolean
          operating_slots?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_venue: {
        Args: {
          p_accessibility_feature_ids: string[]
          p_facility_ids: string[]
          p_layouts: Json
          p_location_id: string
          p_max_capacity: number
          p_name: string
          p_operating_slots: string[]
        }
        Returns: string
      }
      update_venue: {
        Args: {
          p_accessibility_feature_ids?: string[]
          p_confirm_affected_bookings?: boolean
          p_expected_updated_at: string
          p_facility_ids?: string[]
          p_layouts?: Json
          p_location_id?: string
          p_max_capacity?: number
          p_name?: string
          p_needs_setup_slot?: boolean
          p_needs_turnaround_slot?: boolean
          p_operating_slots?: string[]
          p_today?: string
          p_venue_id: string
        }
        Returns: string
      }
    }
    Enums: {
      event_request_status:
        | "draft"
        | "submitted"
        | "approved"
        | "clarification_requested"
        | "rejected"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
    Enums: {
      event_request_status: [
        "draft",
        "submitted",
        "approved",
        "clarification_requested",
        "rejected",
      ],
    },
  },
} as const

