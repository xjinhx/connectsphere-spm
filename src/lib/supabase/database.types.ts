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
      equipment: {
        Row: {
          category: string
          created_at: string
          created_by: string
          current_location: string
          id: string
          name: string
          operational_status: string
          quantity: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by: string
          current_location: string
          id?: string
          name: string
          operational_status?: string
          quantity: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          current_location?: string
          id?: string
          name?: string
          operational_status?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      equipment_request: {
        Row: {
          created_at: string
          event_request_id: string
          status: string
          technical_requirements: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_request_id: string
          status?: string
          technical_requirements?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_request_id?: string
          status?: string
          technical_requirements?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_request_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: true
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_request_line: {
        Row: {
          created_at: string
          created_by: string
          equipment_id: string
          event_request_id: string
          id: string
          quantity: number
          unavailable: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          equipment_id: string
          event_request_id: string
          id?: string
          quantity: number
          unavailable?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          equipment_id?: string
          event_request_id?: string
          id?: string
          quantity?: number
          unavailable?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_request_line_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_request_line_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "equipment_request"
            referencedColumns: ["event_request_id"]
          },
        ]
      }
      equipment_reservation: {
        Row: {
          created_at: string
          equipment_id: string
          event_request_id: string
          id: string
          line_id: string
          quantity: number
          reserved_by: string | null
          status: string
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          created_at?: string
          equipment_id: string
          event_request_id: string
          id?: string
          line_id: string
          quantity: number
          reserved_by?: string | null
          status?: string
          updated_at?: string
          window_end: string
          window_start: string
        }
        Update: {
          created_at?: string
          equipment_id?: string
          event_request_id?: string
          id?: string
          line_id?: string
          quantity?: number
          reserved_by?: string | null
          status?: string
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_reservation_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_reservation_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_reservation_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: true
            referencedRelation: "equipment_request_line"
            referencedColumns: ["id"]
          },
        ]
      }
      event_essential_arrangements: {
        Row: {
          equipment: boolean
          event_request_id: string
          recorded_at: string
          recorded_by: string
          registration: boolean
          technical_support: boolean
          venue: boolean
        }
        Insert: {
          equipment: boolean
          event_request_id: string
          recorded_at?: string
          recorded_by: string
          registration: boolean
          technical_support: boolean
          venue: boolean
        }
        Update: {
          equipment?: boolean
          event_request_id?: string
          recorded_at?: string
          recorded_by?: string
          registration?: boolean
          technical_support?: boolean
          venue?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "event_essential_arrangements_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: true
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
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
          client_contact_email: string | null
          client_contact_name: string | null
          client_contact_phone: string | null
          client_organisation_id: string | null
          coordinator_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          description: string | null
          end_time: string | null
          equipment_required: boolean | null
          expected_attendance: number | null
          id: string
          internal_notes: string | null
          name: string
          organiser_id: string
          preferred_location_id: string | null
          proposed_date: string | null
          purpose: string | null
          reference: string
          registration_required: boolean | null
          rejection_reason: string | null
          room_layout: string | null
          start_time: string | null
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
          client_contact_email?: string | null
          client_contact_name?: string | null
          client_contact_phone?: string | null
          client_organisation_id?: string | null
          coordinator_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          description?: string | null
          end_time?: string | null
          equipment_required?: boolean | null
          expected_attendance?: number | null
          id?: string
          internal_notes?: string | null
          name: string
          organiser_id: string
          preferred_location_id?: string | null
          proposed_date?: string | null
          purpose?: string | null
          reference?: string
          registration_required?: boolean | null
          rejection_reason?: string | null
          room_layout?: string | null
          start_time?: string | null
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
          client_contact_email?: string | null
          client_contact_name?: string | null
          client_contact_phone?: string | null
          client_organisation_id?: string | null
          coordinator_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          description?: string | null
          end_time?: string | null
          equipment_required?: boolean | null
          expected_attendance?: number | null
          id?: string
          internal_notes?: string | null
          name?: string
          organiser_id?: string
          preferred_location_id?: string | null
          proposed_date?: string | null
          purpose?: string | null
          reference?: string
          registration_required?: boolean | null
          rejection_reason?: string | null
          room_layout?: string | null
          start_time?: string | null
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
      notifications: {
        Row: {
          created_at: string
          event_request_id: string
          id: string
          message: string
          read_at: string | null
          recipient_id: string
          type: string
        }
        Insert: {
          created_at?: string
          event_request_id: string
          id?: string
          message: string
          read_at?: string | null
          recipient_id: string
          type: string
        }
        Update: {
          created_at?: string
          event_request_id?: string
          id?: string
          message?: string
          read_at?: string | null
          recipient_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
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
      safety_check: {
        Row: {
          decided_at: string
          decided_by: string
          decision: string
          event_request_id: string
          id: string
          note: string | null
        }
        Insert: {
          decided_at?: string
          decided_by: string
          decision: string
          event_request_id: string
          id?: string
          note?: string | null
        }
        Update: {
          decided_at?: string
          decided_by?: string
          decision?: string
          event_request_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_check_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_turnaround_affected_booking: {
        Row: {
          booking_id: string
          flagged_at: string
          id: string
          setup_minutes: number
          turnaround_minutes: number
          venue_id: string
        }
        Insert: {
          booking_id: string
          flagged_at?: string
          id?: string
          setup_minutes: number
          turnaround_minutes: number
          venue_id: string
        }
        Update: {
          booking_id?: string
          flagged_at?: string
          id?: string
          setup_minutes?: number
          turnaround_minutes?: number
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "setup_turnaround_affected_booking_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "affected_booking_slot"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "setup_turnaround_affected_booking_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "venue_booking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setup_turnaround_affected_booking_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
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
          date: string
          end_time: string
          event_request_id: string
          id: string
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          request_line_id: string | null
          slot: string | null
          start_time: string
          status: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time: string
          event_request_id: string
          id?: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          request_line_id?: string | null
          slot?: string | null
          start_time: string
          status?: string
          venue_id: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string
          event_request_id?: string
          id?: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          request_line_id?: string | null
          slot?: string | null
          start_time?: string
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
            foreignKeyName: "venue_booking_request_line_id_fkey"
            columns: ["request_line_id"]
            isOneToOne: false
            referencedRelation: "venue_booking_request_line"
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
      venue_booking_request: {
        Row: {
          accessibility_notes: string | null
          accessibility_required: boolean | null
          created_at: string
          event_request_id: string
          expected_attendance: number | null
          id: string
          replaces_booking_id: string | null
          requested_by: string
          room_layout: string | null
          venue_id: string
        }
        Insert: {
          accessibility_notes?: string | null
          accessibility_required?: boolean | null
          created_at?: string
          event_request_id: string
          expected_attendance?: number | null
          id?: string
          replaces_booking_id?: string | null
          requested_by: string
          room_layout?: string | null
          venue_id: string
        }
        Update: {
          accessibility_notes?: string | null
          accessibility_required?: boolean | null
          created_at?: string
          event_request_id?: string
          expected_attendance?: number | null
          id?: string
          replaces_booking_id?: string | null
          requested_by?: string
          room_layout?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_booking_request_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_booking_request_replaces_booking_id_fkey"
            columns: ["replaces_booking_id"]
            isOneToOne: false
            referencedRelation: "affected_booking_slot"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "venue_booking_request_replaces_booking_id_fkey"
            columns: ["replaces_booking_id"]
            isOneToOne: false
            referencedRelation: "venue_booking"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_booking_request_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_booking_request_line: {
        Row: {
          created_at: string
          date: string
          decided_at: string | null
          decided_by: string | null
          end_time: string
          id: string
          rejection_reason: string | null
          request_id: string
          start_time: string
          status: string
          suggested_date: string | null
          suggested_end_time: string | null
          suggested_slots: string[] | null
          suggested_start_time: string | null
          suggested_venue_id: string | null
          time_slots: string[] | null
        }
        Insert: {
          created_at?: string
          date: string
          decided_at?: string | null
          decided_by?: string | null
          end_time: string
          id?: string
          rejection_reason?: string | null
          request_id: string
          start_time: string
          status?: string
          suggested_date?: string | null
          suggested_end_time?: string | null
          suggested_slots?: string[] | null
          suggested_start_time?: string | null
          suggested_venue_id?: string | null
          time_slots?: string[] | null
        }
        Update: {
          created_at?: string
          date?: string
          decided_at?: string | null
          decided_by?: string | null
          end_time?: string
          id?: string
          rejection_reason?: string | null
          request_id?: string
          start_time?: string
          status?: string
          suggested_date?: string | null
          suggested_end_time?: string | null
          suggested_slots?: string[] | null
          suggested_start_time?: string | null
          suggested_venue_id?: string | null
          time_slots?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "venue_booking_request_line_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "venue_booking_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_booking_request_line_suggested_venue_id_fkey"
            columns: ["suggested_venue_id"]
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
      venue_hold: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          date: string
          end_time: string
          event_request_id: string
          expires_at: string
          expiry_warning_sent_at: string | null
          id: string
          lapse_notified_at: string | null
          start_time: string
          status: string
          venue_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          date: string
          end_time: string
          event_request_id: string
          expires_at: string
          expiry_warning_sent_at?: string | null
          id?: string
          lapse_notified_at?: string | null
          start_time: string
          status?: string
          venue_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          date?: string
          end_time?: string
          event_request_id?: string
          expires_at?: string
          expiry_warning_sent_at?: string | null
          id?: string
          lapse_notified_at?: string | null
          start_time?: string
          status?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_hold_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_hold_venue_id_fkey"
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
      venue_suitability_check: {
        Row: {
          checked_at: string
          checked_by: string
          event_request_id: string
          id: string
          needs: Json
          requirements: Json
          venue_booking_request_id: string | null
          venue_id: string
          verdict: string
        }
        Insert: {
          checked_at?: string
          checked_by: string
          event_request_id: string
          id?: string
          needs: Json
          requirements: Json
          venue_booking_request_id?: string | null
          venue_id: string
          verdict: string
        }
        Update: {
          checked_at?: string
          checked_by?: string
          event_request_id?: string
          id?: string
          needs?: Json
          requirements?: Json
          venue_booking_request_id?: string | null
          venue_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_suitability_check_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_suitability_check_venue_booking_request_id_fkey"
            columns: ["venue_booking_request_id"]
            isOneToOne: false
            referencedRelation: "venue_booking_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_suitability_check_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_unavailability_notice: {
        Row: {
          coordinator_id: string
          created_at: string
          end_time: string | null
          event_request_id: string
          id: string
          reason: string
          slot_date: string
          slots: string[] | null
          start_time: string | null
          venue_id: string
        }
        Insert: {
          coordinator_id: string
          created_at?: string
          end_time?: string | null
          event_request_id: string
          id?: string
          reason: string
          slot_date: string
          slots?: string[] | null
          start_time?: string | null
          venue_id: string
        }
        Update: {
          coordinator_id?: string
          created_at?: string
          end_time?: string | null
          event_request_id?: string
          id?: string
          reason?: string
          slot_date?: string
          slots?: string[] | null
          start_time?: string | null
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_unavailability_notice_event_request_id_fkey"
            columns: ["event_request_id"]
            isOneToOne: false
            referencedRelation: "event_request"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_unavailability_notice_venue_id_fkey"
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
          end_time: string
          id: string
          reason: string
          recorded_by: string | null
          slot: string | null
          start_time: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time: string
          id?: string
          reason: string
          recorded_by?: string | null
          slot?: string | null
          start_time: string
          venue_id: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          reason?: string
          recorded_by?: string | null
          slot?: string | null
          start_time?: string
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
          closes_at: string
          created_at: string
          id: string
          is_retired: boolean
          location_id: string
          max_capacity: number
          name: string
          needs_setup_slot: boolean
          needs_turnaround_slot: boolean
          opens_at: string
          operating_slots: string[]
          setup_minutes: number
          turnaround_minutes: number
          updated_at: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          id?: string
          is_retired?: boolean
          location_id: string
          max_capacity: number
          name: string
          needs_setup_slot?: boolean
          needs_turnaround_slot?: boolean
          opens_at: string
          operating_slots?: string[]
          setup_minutes?: number
          turnaround_minutes?: number
          updated_at?: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          id?: string
          is_retired?: boolean
          location_id?: string
          max_capacity?: number
          name?: string
          needs_setup_slot?: boolean
          needs_turnaround_slot?: boolean
          opens_at?: string
          operating_slots?: string[]
          setup_minutes?: number
          turnaround_minutes?: number
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
      affected_booking_slot: {
        Row: {
          booking_id: string | null
          coordinator_id: string | null
          end_time: string | null
          event_request_id: string | null
          reason: string | null
          slot: string | null
          slot_date: string | null
          start_time: string | null
          unavailable_end_time: string | null
          unavailable_start_time: string | null
          venue_id: string | null
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
    }
    Functions: {
      clock_minutes: { Args: { p_time: string }; Returns: number }
      create_venue: {
        Args: {
          p_accessibility_feature_ids: string[]
          p_closes_at?: string
          p_facility_ids: string[]
          p_layouts: Json
          p_location_id: string
          p_max_capacity: number
          p_name: string
          p_opens_at?: string
          p_operating_slots: string[]
        }
        Returns: string
      }
      create_venue_booking_request: {
        Args: {
          p_accessibility_notes?: string
          p_accessibility_required?: boolean
          p_event_request_id: string
          p_expected_attendance?: number
          p_lines: Json
          p_replaces_booking_id?: string
          p_requested_by: string
          p_room_layout?: string
          p_venue_id: string
        }
        Returns: string
      }
      decide_venue_booking_request: {
        Args: { p_decided_by: string; p_decisions: Json; p_request_id: string }
        Returns: Json
      }
      describe_hold_period: {
        Args: {
          p_date: string
          p_end: string
          p_start: string
          p_venue_name: string
        }
        Returns: string
      }
      equipment_window: {
        Args: { p_event_request_id: string }
        Returns: {
          window_end: string
          window_start: string
        }[]
      }
      format_singapore_instant: { Args: { p_instant: string }; Returns: string }
      is_quarter_hour: { Args: { p_time: string }; Returns: boolean }
      mark_period_unavailable: {
        Args: {
          p_date: string
          p_end: string
          p_reason: string
          p_recorded_by: string
          p_start: string
          p_today?: string
          p_venue_id: string
        }
        Returns: Json
      }
      notify_hold_expiries: { Args: { p_now?: string }; Returns: number }
      record_essential_arrangements: {
        Args: {
          p_equipment: boolean
          p_event_request_id: string
          p_recorded_by: string
          p_registration: boolean
          p_technical_support: boolean
          p_venue: boolean
        }
        Returns: string
      }
      record_safety_check: {
        Args: {
          p_decided_by: string
          p_decision: string
          p_event_request_id: string
          p_note: string
        }
        Returns: string
      }
      reserve_equipment: {
        Args: { p_line_id: string; p_quantity: number; p_reserved_by: string }
        Returns: Json
      }
      slot_end_time: { Args: { p_slot: string }; Returns: string }
      slot_start_time: { Args: { p_slot: string }; Returns: string }
      update_venue: {
        Args: {
          p_accessibility_feature_ids?: string[]
          p_closes_at?: string
          p_confirm_affected_bookings?: boolean
          p_confirm_setup_turnaround_change?: boolean
          p_expected_updated_at: string
          p_facility_ids?: string[]
          p_layouts?: Json
          p_location_id?: string
          p_max_capacity?: number
          p_name?: string
          p_needs_setup_slot?: boolean
          p_needs_turnaround_slot?: boolean
          p_opens_at?: string
          p_operating_slots?: string[]
          p_setup_minutes?: number
          p_today?: string
          p_turnaround_minutes?: number
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
        | "planning"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "preparation"
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
        "planning",
        "confirmed",
        "completed",
        "cancelled",
        "preparation",
      ],
    },
  },
} as const

