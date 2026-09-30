import type { DbColumn, LogicalType } from "@/lib/types";

/**
 * Column shorthand DSL used by the blueprint dictionary.
 *   name:string(120)          -> varchar(120)
 *   email:email!              -> unique
 *   bio:text?                 -> nullable
 *   status:enum(new|paid)     -> enum with values
 *   user_id->users            -> foreign key to users.id
 *   created_at:datetime=now   -> default current timestamp
 */
export function col(spec: string): DbColumn {
  let working = spec.trim();
  let references: DbColumn["references"];

  const fkMatch = working.match(/^([a-z0-9_]+)->([a-z0-9_]+)(?:\.([a-z0-9_]+))?(\?)?$/i);
  if (fkMatch) {
    references = {
      table: fkMatch[2],
      column: fkMatch[3] ?? "id",
      onDelete: fkMatch[4] ? "set null" : "cascade",
    };
    return {
      name: fkMatch[1],
      type: "fk",
      nullable: Boolean(fkMatch[4]),
      references,
    };
  }

  let defaultNow = false;
  if (working.includes("=now")) {
    defaultNow = true;
    working = working.replace("=now", "");
  }

  let unique = false;
  if (working.endsWith("!")) {
    unique = true;
    working = working.slice(0, -1);
  }

  let nullable = false;
  if (working.endsWith("?")) {
    nullable = true;
    working = working.slice(0, -1);
  }

  const [rawName, rawType = "string"] = working.split(":");
  let type = rawType;
  let length: number | undefined;
  let enumValues: string[] | undefined;

  const lengthMatch = type.match(/^([a-z]+)\((\d+)\)$/);
  if (lengthMatch) {
    type = lengthMatch[1];
    length = Number(lengthMatch[2]);
  }

  const enumMatch = type.match(/^enum\(([^)]+)\)$/);
  if (enumMatch) {
    type = "enum";
    enumValues = enumMatch[1].split("|").map((value) => value.trim());
  }

  return {
    name: rawName,
    type: type as LogicalType,
    length,
    enumValues,
    nullable,
    unique,
    defaultNow,
  };
}

export interface EntityBlueprint {
  description: string;
  columns: string[];
}

/** Canonical (plural, snake_case) table blueprints. */
export const ENTITY_BLUEPRINTS: Record<string, EntityBlueprint> = {
  users: {
    description: "Application accounts and login credentials",
    columns: [
      "full_name:string(120)",
      "email:email(160)!",
      "phone:phone(25)?",
      "password_hash:string(255)",
      "role:enum(admin|staff|customer)",
      "avatar_url:url?",
      "is_active:bool",
      "created_at:datetime=now",
    ],
  },
  profiles: {
    description: "Extended user profile details",
    columns: [
      "user_id->users",
      "bio:text?",
      "date_of_birth:date?",
      "gender:enum(male|female|other)?",
      "address:string(200)?",
      "city:string(80)?",
      "country:string(80)?",
    ],
  },
  customers: {
    description: "People or businesses that buy from you",
    columns: [
      "full_name:string(120)",
      "email:email(160)?",
      "phone:phone(25)",
      "address:string(200)?",
      "city:string(80)?",
      "loyalty_points:int",
      "created_at:datetime=now",
    ],
  },
  patients: {
    description: "Registered hospital patients",
    columns: [
      "patient_code:string(30)!",
      "full_name:string(120)",
      "date_of_birth:date",
      "gender:enum(male|female|other)",
      "blood_group:string(5)?",
      "phone:phone(25)",
      "email:email(160)?",
      "address:string(200)?",
      "emergency_contact:string(120)?",
      "created_at:datetime=now",
    ],
  },
  doctors: {
    description: "Medical practitioners on staff",
    columns: [
      "full_name:string(120)",
      "specialization:string(80)",
      "license_number:string(50)!",
      "department_id->departments?",
      "phone:phone(25)",
      "email:email(160)?",
      "consultation_fee:money",
      "is_available:bool",
    ],
  },
  nurses: {
    description: "Nursing staff assigned to wards",
    columns: [
      "full_name:string(120)",
      "department_id->departments?",
      "shift:enum(morning|afternoon|night)",
      "phone:phone(25)",
      "hired_on:date",
    ],
  },
  departments: {
    description: "Organisational units",
    columns: [
      "name:string(80)!",
      "code:string(20)?",
      "description:text?",
      "location:string(120)?",
    ],
  },
  appointments: {
    description: "Scheduled appointments between clients and staff",
    columns: [
      "patient_id->patients",
      "doctor_id->doctors",
      "scheduled_at:datetime",
      "duration_minutes:int",
      "reason:string(200)?",
      "status:enum(scheduled|completed|cancelled|no_show)",
      "created_at:datetime=now",
    ],
  },
  prescriptions: {
    description: "Medication prescribed after a visit",
    columns: [
      "appointment_id->appointments?",
      "patient_id->patients",
      "doctor_id->doctors",
      "medication:string(120)",
      "dosage:string(60)",
      "instructions:text?",
      "issued_at:datetime=now",
    ],
  },
  medical_records: {
    description: "Clinical history per patient",
    columns: [
      "patient_id->patients",
      "doctor_id->doctors?",
      "diagnosis:string(200)",
      "treatment:text?",
      "notes:text?",
      "recorded_at:datetime=now",
    ],
  },
  wards: {
    description: "Hospital wards and bed capacity",
    columns: [
      "name:string(80)!",
      "department_id->departments?",
      "total_beds:int",
      "occupied_beds:int",
    ],
  },
  admissions: {
    description: "In-patient admissions",
    columns: [
      "patient_id->patients",
      "ward_id->wards?",
      "admitted_at:datetime",
      "discharged_at:datetime?",
      "status:enum(admitted|discharged|transferred)",
    ],
  },
  products: {
    description: "Items available for sale",
    columns: [
      "name:string(150)",
      "sku:string(50)!",
      "slug:slug(160)?",
      "category_id->categories?",
      "description:text?",
      "price:money",
      "cost_price:money?",
      "stock_quantity:int",
      "image_url:url?",
      "is_active:bool",
      "created_at:datetime=now",
    ],
  },
  categories: {
    description: "Grouping for products or content",
    columns: [
      "name:string(80)!",
      "slug:slug(100)?",
      "description:text?",
      "parent_id->categories?",
    ],
  },
  orders: {
    description: "Customer purchase orders",
    columns: [
      "order_number:string(30)!",
      "user_id->users",
      "total_amount:money",
      "status:enum(pending|paid|shipped|delivered|cancelled)",
      "shipping_address:string(200)?",
      "placed_at:datetime=now",
    ],
  },
  order_items: {
    description: "Line items belonging to an order",
    columns: [
      "order_id->orders",
      "product_id->products",
      "quantity:int",
      "unit_price:money",
      "subtotal:money",
    ],
  },
  carts: {
    description: "Shopping carts in progress",
    columns: [
      "user_id->users",
      "status:enum(active|converted|abandoned)",
      "created_at:datetime=now",
    ],
  },
  cart_items: {
    description: "Products inside a cart",
    columns: ["cart_id->carts", "product_id->products", "quantity:int"],
  },
  payments: {
    description: "Payments received against orders, bookings or invoices",
    columns: [
      "order_id->orders?",
      "user_id->users?",
      "amount:money",
      "method:enum(cash|card|mobile_money|bank_transfer)",
      "reference:string(60)!",
      "status:enum(pending|successful|failed|refunded)",
      "paid_at:datetime=now",
    ],
  },
  invoices: {
    description: "Billing documents",
    columns: [
      "invoice_number:string(30)!",
      "customer_id->customers?",
      "amount:money",
      "tax:money?",
      "status:enum(draft|sent|paid|overdue)",
      "due_date:date",
      "created_at:datetime=now",
    ],
  },
  shipments: {
    description: "Delivery tracking for orders",
    columns: [
      "order_id->orders",
      "courier:string(80)",
      "tracking_number:string(60)?",
      "status:enum(pending|in_transit|delivered|returned)",
      "shipped_at:datetime?",
    ],
  },
  reviews: {
    description: "Ratings and feedback",
    columns: [
      "product_id->products?",
      "user_id->users",
      "rating:int",
      "title:string(120)?",
      "comment:text?",
      "created_at:datetime=now",
    ],
  },
  students: {
    description: "Enrolled learners",
    columns: [
      "admission_number:string(30)!",
      "full_name:string(120)",
      "date_of_birth:date",
      "gender:enum(male|female|other)",
      "class_id->classes?",
      "parent_id->parents?",
      "phone:phone(25)?",
      "enrolled_on:date",
    ],
  },
  teachers: {
    description: "Teaching staff",
    columns: [
      "staff_number:string(30)!",
      "full_name:string(120)",
      "subject_id->subjects?",
      "email:email(160)?",
      "phone:phone(25)",
      "salary:money?",
      "hired_on:date",
    ],
  },
  classes: {
    description: "Class / grade groupings",
    columns: [
      "name:string(50)!",
      "level:string(30)?",
      "teacher_id->teachers?",
      "room:string(40)?",
      "capacity:int",
    ],
  },
  subjects: {
    description: "Courses taught in school",
    columns: [
      "name:string(80)!",
      "code:string(20)!",
      "description:text?",
      "credit_hours:int",
    ],
  },
  enrollments: {
    description: "Links students to classes or courses",
    columns: [
      "student_id->students",
      "class_id->classes?",
      "subject_id->subjects?",
      "term:string(30)",
      "enrolled_at:datetime=now",
    ],
  },
  grades: {
    description: "Scores recorded per student",
    columns: [
      "student_id->students",
      "subject_id->subjects",
      "term:string(30)",
      "score:decimal",
      "letter_grade:string(2)?",
      "recorded_at:datetime=now",
    ],
  },
  attendance: {
    description: "Daily presence records",
    columns: [
      "student_id->students?",
      "employee_id->employees?",
      "date:date",
      "status:enum(present|absent|late|excused)",
      "remark:string(120)?",
    ],
  },
  parents: {
    description: "Guardians linked to students",
    columns: [
      "full_name:string(120)",
      "relationship:enum(father|mother|guardian)",
      "phone:phone(25)",
      "email:email(160)?",
      "address:string(200)?",
      "occupation:string(80)?",
    ],
  },
  fees: {
    description: "School fee records",
    columns: [
      "student_id->students",
      "term:string(30)",
      "amount:money",
      "amount_paid:money",
      "status:enum(unpaid|partial|paid)",
      "due_date:date",
    ],
  },
  employees: {
    description: "Staff records",
    columns: [
      "employee_code:string(30)!",
      "full_name:string(120)",
      "department_id->departments?",
      "position:string(80)",
      "email:email(160)?",
      "phone:phone(25)",
      "salary:money",
      "hired_on:date",
      "status:enum(active|on_leave|terminated)",
    ],
  },
  payroll: {
    description: "Monthly salary payouts",
    columns: [
      "employee_id->employees",
      "period:string(20)",
      "gross_pay:money",
      "deductions:money",
      "net_pay:money",
      "paid_on:date",
    ],
  },
  leaves: {
    description: "Leave and time-off requests",
    columns: [
      "employee_id->employees",
      "type:enum(annual|sick|maternity|unpaid)",
      "start_date:date",
      "end_date:date",
      "status:enum(pending|approved|rejected)",
      "reason:text?",
    ],
  },
  suppliers: {
    description: "Vendors that restock your inventory",
    columns: [
      "name:string(120)",
      "contact_person:string(100)?",
      "email:email(160)?",
      "phone:phone(25)",
      "address:string(200)?",
    ],
  },
  warehouses: {
    description: "Storage locations",
    columns: [
      "name:string(100)!",
      "location:string(150)",
      "capacity:int",
      "manager:string(100)?",
    ],
  },
  stock_movements: {
    description: "Every stock in/out event",
    columns: [
      "product_id->products",
      "warehouse_id->warehouses?",
      "type:enum(in|out|adjustment)",
      "quantity:int",
      "reference:string(60)?",
      "moved_at:datetime=now",
    ],
  },
  purchase_orders: {
    description: "Restock requests sent to suppliers",
    columns: [
      "po_number:string(30)!",
      "supplier_id->suppliers",
      "total_amount:money",
      "status:enum(draft|sent|received|cancelled)",
      "ordered_at:datetime=now",
    ],
  },
  purchase_order_items: {
    description: "Items on a purchase order",
    columns: [
      "purchase_order_id->purchase_orders",
      "product_id->products",
      "quantity:int",
      "unit_cost:money",
    ],
  },
  posts: {
    description: "Articles or blog entries",
    columns: [
      "title:string(180)",
      "slug:slug(200)!",
      "user_id->users",
      "category_id->categories?",
      "excerpt:string(255)?",
      "body:text",
      "cover_image:url?",
      "status:enum(draft|published|archived)",
      "published_at:datetime?",
    ],
  },
  comments: {
    description: "Reader responses",
    columns: [
      "post_id->posts?",
      "user_id->users",
      "parent_id->comments?",
      "body:text",
      "is_approved:bool",
      "created_at:datetime=now",
    ],
  },
  tags: {
    description: "Free-form labels",
    columns: ["name:string(60)!", "slug:slug(80)!"],
  },
  post_tags: {
    description: "Many-to-many between posts and tags",
    columns: ["post_id->posts", "tag_id->tags"],
  },
  likes: {
    description: "Reactions on content",
    columns: ["user_id->users", "post_id->posts", "created_at:datetime=now"],
  },
  follows: {
    description: "Follower graph",
    columns: [
      "follower_id->users",
      "following_id->users",
      "created_at:datetime=now",
    ],
  },
  messages: {
    description: "Direct messages between users",
    columns: [
      "sender_id->users",
      "receiver_id->users",
      "body:text",
      "is_read:bool",
      "sent_at:datetime=now",
    ],
  },
  notifications: {
    description: "In-app alerts",
    columns: [
      "user_id->users",
      "title:string(150)",
      "body:text?",
      "type:string(50)",
      "is_read:bool",
      "created_at:datetime=now",
    ],
  },
  accounts: {
    description: "Bank or wallet accounts",
    columns: [
      "account_number:string(30)!",
      "customer_id->customers",
      "type:enum(savings|current|wallet|fixed)",
      "balance:money",
      "currency:string(3)",
      "opened_on:date",
      "status:enum(active|dormant|closed)",
    ],
  },
  transactions: {
    description: "Money movement records",
    columns: [
      "account_id->accounts",
      "reference:string(40)!",
      "type:enum(deposit|withdrawal|transfer|fee)",
      "amount:money",
      "balance_after:money",
      "description:string(200)?",
      "created_at:datetime=now",
    ],
  },
  loans: {
    description: "Credit issued to customers",
    columns: [
      "customer_id->customers",
      "principal:money",
      "interest_rate:decimal",
      "term_months:int",
      "status:enum(pending|approved|active|repaid|defaulted)",
      "disbursed_on:date?",
    ],
  },
  loan_payments: {
    description: "Repayment installments",
    columns: [
      "loan_id->loans",
      "amount:money",
      "paid_on:date",
      "method:enum(cash|bank_transfer|mobile_money)",
    ],
  },
  branches: {
    description: "Physical locations",
    columns: [
      "name:string(100)!",
      "code:string(20)!",
      "address:string(200)",
      "city:string(80)",
      "phone:phone(25)?",
    ],
  },
  rooms: {
    description: "Bookable rooms",
    columns: [
      "room_number:string(20)!",
      "room_type_id->room_types?",
      "floor:int",
      "status:enum(available|occupied|maintenance)",
      "price_per_night:money",
    ],
  },
  room_types: {
    description: "Room categories and rates",
    columns: [
      "name:string(60)!",
      "description:text?",
      "base_price:money",
      "max_occupancy:int",
    ],
  },
  guests: {
    description: "Hotel guests",
    columns: [
      "full_name:string(120)",
      "email:email(160)?",
      "phone:phone(25)",
      "id_number:string(50)?",
      "nationality:string(60)?",
      "created_at:datetime=now",
    ],
  },
  bookings: {
    description: "Reservations for rooms or services",
    columns: [
      "booking_code:string(20)!",
      "guest_id->guests?",
      "room_id->rooms?",
      "check_in:date",
      "check_out:date",
      "total_amount:money",
      "status:enum(pending|confirmed|checked_in|checked_out|cancelled)",
      "created_at:datetime=now",
    ],
  },
  reservations: {
    description: "Table or seat reservations",
    columns: [
      "customer_id->customers?",
      "table_number:string(20)",
      "party_size:int",
      "reserved_for:datetime",
      "status:enum(pending|confirmed|seated|cancelled)",
    ],
  },
  menu_items: {
    description: "Dishes available on the menu",
    columns: [
      "name:string(120)",
      "category_id->categories?",
      "description:text?",
      "price:money",
      "is_available:bool",
      "image_url:url?",
    ],
  },
  events: {
    description: "Scheduled events or programmes",
    columns: [
      "title:string(150)",
      "description:text?",
      "venue:string(150)?",
      "starts_at:datetime",
      "ends_at:datetime?",
      "capacity:int",
      "ticket_price:money?",
      "status:enum(draft|published|cancelled|completed)",
    ],
  },
  tickets: {
    description: "Tickets sold for events",
    columns: [
      "event_id->events",
      "user_id->users?",
      "ticket_code:string(30)!",
      "type:enum(regular|vip|vvip)",
      "price:money",
      "is_used:bool",
      "purchased_at:datetime=now",
    ],
  },
  members: {
    description: "Registered members",
    columns: [
      "membership_number:string(30)!",
      "full_name:string(120)",
      "phone:phone(25)",
      "email:email(160)?",
      "date_of_birth:date?",
      "joined_on:date",
      "status:enum(active|inactive|suspended)",
    ],
  },
  memberships: {
    description: "Subscription plans held by members",
    columns: [
      "member_id->members",
      "plan:enum(daily|monthly|quarterly|yearly)",
      "amount:money",
      "starts_on:date",
      "expires_on:date",
      "status:enum(active|expired|cancelled)",
    ],
  },
  trainers: {
    description: "Coaches and instructors",
    columns: [
      "full_name:string(120)",
      "specialty:string(80)",
      "phone:phone(25)",
      "hourly_rate:money",
    ],
  },
  books: {
    description: "Library catalogue",
    columns: [
      "isbn:string(20)!",
      "title:string(200)",
      "author_id->authors?",
      "category_id->categories?",
      "published_year:int",
      "total_copies:int",
      "available_copies:int",
    ],
  },
  authors: {
    description: "Writers in the catalogue",
    columns: ["full_name:string(120)", "country:string(80)?", "bio:text?"],
  },
  borrowings: {
    description: "Book loan records",
    columns: [
      "book_id->books",
      "member_id->members",
      "borrowed_on:date",
      "due_on:date",
      "returned_on:date?",
      "fine:money?",
      "status:enum(borrowed|returned|overdue)",
    ],
  },
  vehicles: {
    description: "Fleet vehicles",
    columns: [
      "plate_number:string(20)!",
      "make:string(60)",
      "model:string(60)",
      "year:int",
      "capacity:int",
      "status:enum(active|maintenance|retired)",
    ],
  },
  drivers: {
    description: "Registered drivers",
    columns: [
      "full_name:string(120)",
      "license_number:string(40)!",
      "phone:phone(25)",
      "vehicle_id->vehicles?",
      "rating:decimal",
      "is_available:bool",
    ],
  },
  trips: {
    description: "Journeys taken by vehicles",
    columns: [
      "driver_id->drivers",
      "vehicle_id->vehicles?",
      "customer_id->customers?",
      "pickup_location:string(150)",
      "dropoff_location:string(150)",
      "fare:money",
      "distance_km:decimal",
      "status:enum(requested|ongoing|completed|cancelled)",
      "started_at:datetime=now",
    ],
  },
  deliveries: {
    description: "Parcel deliveries",
    columns: [
      "order_id->orders?",
      "driver_id->drivers?",
      "address:string(200)",
      "status:enum(pending|picked_up|delivered|failed)",
      "delivered_at:datetime?",
    ],
  },
  properties: {
    description: "Real estate listings",
    columns: [
      "title:string(150)",
      "agent_id->agents?",
      "type:enum(house|apartment|land|commercial)",
      "address:string(200)",
      "city:string(80)",
      "bedrooms:int",
      "bathrooms:int",
      "price:money",
      "status:enum(available|rented|sold)",
      "listed_at:datetime=now",
    ],
  },
  agents: {
    description: "Sales or letting agents",
    columns: [
      "full_name:string(120)",
      "email:email(160)?",
      "phone:phone(25)",
      "commission_rate:decimal",
    ],
  },
  leases: {
    description: "Rental agreements",
    columns: [
      "property_id->properties",
      "tenant_id->customers?",
      "start_date:date",
      "end_date:date",
      "monthly_rent:money",
      "deposit:money?",
      "status:enum(active|ended|terminated)",
    ],
  },
  companies: {
    description: "Organisations in your CRM",
    columns: [
      "name:string(150)",
      "industry:string(80)?",
      "website:url?",
      "phone:phone(25)?",
      "city:string(80)?",
      "created_at:datetime=now",
    ],
  },
  contacts: {
    description: "People at companies",
    columns: [
      "company_id->companies?",
      "full_name:string(120)",
      "job_title:string(80)?",
      "email:email(160)?",
      "phone:phone(25)?",
    ],
  },
  leads: {
    description: "Potential customers",
    columns: [
      "full_name:string(120)",
      "email:email(160)?",
      "phone:phone(25)?",
      "source:enum(website|referral|ads|walk_in)",
      "status:enum(new|contacted|qualified|lost)",
      "owner_id->users?",
      "created_at:datetime=now",
    ],
  },
  deals: {
    description: "Sales opportunities in the pipeline",
    columns: [
      "title:string(150)",
      "company_id->companies?",
      "owner_id->users?",
      "value:money",
      "stage:enum(prospect|proposal|negotiation|won|lost)",
      "expected_close:date?",
    ],
  },
  tasks: {
    description: "To-do items",
    columns: [
      "title:string(150)",
      "project_id->projects?",
      "assignee_id->users?",
      "description:text?",
      "priority:enum(low|medium|high|urgent)",
      "status:enum(todo|in_progress|review|done)",
      "due_date:date?",
      "created_at:datetime=now",
    ],
  },
  projects: {
    description: "Work projects",
    columns: [
      "name:string(150)",
      "team_id->teams?",
      "description:text?",
      "status:enum(planning|active|on_hold|completed)",
      "start_date:date",
      "end_date:date?",
      "budget:money?",
    ],
  },
  teams: {
    description: "Groups of collaborating users",
    columns: ["name:string(100)!", "description:text?", "owner_id->users?"],
  },
  subscriptions: {
    description: "Recurring plans",
    columns: [
      "user_id->users",
      "plan:enum(free|monthly|yearly)",
      "amount:money",
      "status:enum(active|past_due|cancelled)",
      "started_on:date",
      "renews_on:date?",
    ],
  },
  donations: {
    description: "Offerings and contributions",
    columns: [
      "member_id->members?",
      "amount:money",
      "type:enum(tithe|offering|pledge|project)",
      "method:enum(cash|mobile_money|bank_transfer)",
      "given_on:date",
    ],
  },
  ministries: {
    description: "Groups and departments in a congregation",
    columns: [
      "name:string(100)!",
      "leader:string(120)?",
      "description:text?",
      "meeting_day:string(20)?",
    ],
  },
  farms: {
    description: "Farm units",
    columns: [
      "name:string(120)",
      "owner:string(120)?",
      "location:string(150)",
      "size_hectares:decimal",
    ],
  },
  crops: {
    description: "Crops planted per season",
    columns: [
      "farm_id->farms?",
      "name:string(100)",
      "variety:string(80)?",
      "planted_on:date",
      "expected_harvest:date?",
      "area_hectares:decimal",
    ],
  },
  harvests: {
    description: "Yield recorded from crops",
    columns: [
      "crop_id->crops",
      "quantity_kg:decimal",
      "quality:enum(a|b|c)",
      "harvested_on:date",
      "revenue:money?",
    ],
  },
  expenses: {
    description: "Money spent",
    columns: [
      "category:string(80)",
      "description:string(200)?",
      "amount:money",
      "paid_by:string(120)?",
      "spent_on:date",
    ],
  },
  services: {
    description: "Services offered to clients",
    columns: [
      "name:string(120)",
      "description:text?",
      "price:money",
      "duration_minutes:int",
      "is_active:bool",
    ],
  },
  files: {
    description: "Uploaded documents and media",
    columns: [
      "user_id->users?",
      "file_name:string(180)",
      "file_url:url",
      "mime_type:string(80)?",
      "size_bytes:bigint",
      "uploaded_at:datetime=now",
    ],
  },
  settings: {
    description: "Key/value configuration",
    columns: ["key:string(80)!", "value:text?", "updated_at:datetime=now"],
  },
  audit_logs: {
    description: "Trail of who did what",
    columns: [
      "user_id->users?",
      "action:string(100)",
      "entity:string(80)?",
      "entity_id:string(60)?",
      "ip_address:string(45)?",
      "created_at:datetime=now",
    ],
  },
};

export interface DomainBlueprint {
  key: string;
  label: string;
  keywords: string[];
  tables: string[];
  /** Tables that survive the free-plan 5-table trim, in order of importance. */
  core: string[];
}

export const DOMAIN_BLUEPRINTS: DomainBlueprint[] = [
  {
    key: "hospital",
    label: "Hospital / Clinic",
    keywords: [
      "hospital",
      "clinic",
      "medical",
      "health",
      "healthcare",
      "patient",
      "doctor",
      "pharmacy",
      "dental",
      "nurse",
    ],
    tables: [
      "departments",
      "doctors",
      "patients",
      "appointments",
      "prescriptions",
      "medical_records",
      "wards",
      "admissions",
      "invoices",
      "users",
    ],
    core: ["patients", "doctors", "appointments", "departments", "prescriptions"],
  },
  {
    key: "ecommerce",
    label: "E-commerce / Online store",
    keywords: [
      "ecommerce",
      "e-commerce",
      "shop",
      "store",
      "online store",
      "marketplace",
      "cart",
      "checkout",
      "product",
      "retail",
      "boutique",
    ],
    tables: [
      "users",
      "categories",
      "products",
      "orders",
      "order_items",
      "payments",
      "carts",
      "cart_items",
      "reviews",
      "shipments",
    ],
    core: ["users", "products", "orders", "order_items", "payments"],
  },
  {
    key: "school",
    label: "School / Education",
    keywords: [
      "school",
      "education",
      "student",
      "teacher",
      "college",
      "university",
      "academy",
      "class",
      "exam",
      "lms",
      "course",
    ],
    tables: [
      "students",
      "teachers",
      "classes",
      "subjects",
      "enrollments",
      "grades",
      "attendance",
      "parents",
      "fees",
    ],
    core: ["students", "teachers", "classes", "subjects", "grades"],
  },
  {
    key: "restaurant",
    label: "Restaurant / Food",
    keywords: [
      "restaurant",
      "food",
      "cafe",
      "menu",
      "kitchen",
      "chop bar",
      "catering",
      "bar",
      "dish",
    ],
    tables: [
      "customers",
      "categories",
      "menu_items",
      "orders",
      "order_items",
      "reservations",
      "payments",
      "employees",
    ],
    core: ["menu_items", "orders", "order_items", "customers", "reservations"],
  },
  {
    key: "hotel",
    label: "Hotel / Hospitality",
    keywords: ["hotel", "lodge", "guest house", "hostel", "resort", "room booking", "accommodation"],
    tables: [
      "guests",
      "room_types",
      "rooms",
      "bookings",
      "payments",
      "services",
      "employees",
      "reviews",
    ],
    core: ["guests", "rooms", "bookings", "payments", "room_types"],
  },
  {
    key: "banking",
    label: "Banking / Fintech",
    keywords: [
      "bank",
      "banking",
      "fintech",
      "wallet",
      "mobile money",
      "microfinance",
      "savings",
      "loan",
      "susu",
      "credit union",
    ],
    tables: [
      "customers",
      "accounts",
      "transactions",
      "loans",
      "loan_payments",
      "branches",
      "audit_logs",
    ],
    core: ["customers", "accounts", "transactions", "loans", "loan_payments"],
  },
  {
    key: "library",
    label: "Library",
    keywords: ["library", "book", "librarian", "borrow", "catalogue", "isbn"],
    tables: ["members", "authors", "categories", "books", "borrowings", "fees"],
    core: ["books", "members", "borrowings", "authors", "categories"],
  },
  {
    key: "church",
    label: "Church / Congregation",
    keywords: ["church", "mosque", "congregation", "ministry", "tithe", "offering", "worship"],
    tables: ["members", "ministries", "events", "attendance", "donations", "expenses"],
    core: ["members", "ministries", "donations", "events", "attendance"],
  },
  {
    key: "gym",
    label: "Gym / Fitness",
    keywords: ["gym", "fitness", "workout", "trainer", "spa", "salon", "wellness"],
    tables: ["members", "memberships", "trainers", "classes", "bookings", "payments"],
    core: ["members", "memberships", "trainers", "bookings", "payments"],
  },
  {
    key: "blog",
    label: "Blog / CMS",
    keywords: ["blog", "cms", "news", "article", "magazine", "publishing", "content"],
    tables: ["users", "categories", "posts", "tags", "post_tags", "comments", "files"],
    core: ["users", "posts", "categories", "comments", "tags"],
  },
  {
    key: "social",
    label: "Social network",
    keywords: ["social", "network", "feed", "follower", "chat", "messaging", "community"],
    tables: ["users", "profiles", "posts", "comments", "likes", "follows", "messages", "notifications"],
    core: ["users", "posts", "comments", "likes", "follows"],
  },
  {
    key: "crm",
    label: "CRM / Sales",
    keywords: ["crm", "sales pipeline", "lead", "deal", "prospect", "customer relationship"],
    tables: ["users", "companies", "contacts", "leads", "deals", "tasks"],
    core: ["companies", "contacts", "leads", "deals", "users"],
  },
  {
    key: "inventory",
    label: "Inventory / Warehouse",
    keywords: ["inventory", "warehouse", "stock", "supplier", "procurement", "logistics stock"],
    tables: [
      "categories",
      "products",
      "suppliers",
      "warehouses",
      "stock_movements",
      "purchase_orders",
      "purchase_order_items",
    ],
    core: ["products", "suppliers", "warehouses", "stock_movements", "purchase_orders"],
  },
  {
    key: "hr",
    label: "HR / Payroll",
    keywords: ["hr", "human resource", "payroll", "employee", "staff management", "salary"],
    tables: ["departments", "employees", "attendance", "leaves", "payroll", "expenses"],
    core: ["employees", "departments", "payroll", "attendance", "leaves"],
  },
  {
    key: "transport",
    label: "Transport / Delivery",
    keywords: [
      "transport",
      "delivery",
      "logistics",
      "taxi",
      "ride",
      "okada",
      "keke",
      "fleet",
      "courier",
      "dispatch",
    ],
    tables: ["customers", "drivers", "vehicles", "trips", "deliveries", "payments"],
    core: ["drivers", "vehicles", "trips", "customers", "payments"],
  },
  {
    key: "realestate",
    label: "Real estate",
    keywords: ["real estate", "property", "rent", "landlord", "tenant", "lease", "housing"],
    tables: ["agents", "properties", "customers", "leases", "payments"],
    core: ["properties", "agents", "leases", "customers", "payments"],
  },
  {
    key: "events",
    label: "Events / Ticketing",
    keywords: ["event", "ticket", "conference", "concert", "festival", "seminar", "wedding"],
    tables: ["users", "events", "tickets", "payments", "reviews"],
    core: ["events", "tickets", "users", "payments", "reviews"],
  },
  {
    key: "agriculture",
    label: "Agriculture / Farm",
    keywords: ["farm", "agriculture", "crop", "harvest", "poultry", "livestock", "agro"],
    tables: ["farms", "crops", "harvests", "expenses", "customers", "orders"],
    core: ["farms", "crops", "harvests", "expenses", "customers"],
  },
  {
    key: "saas",
    label: "SaaS / Project management",
    keywords: ["saas", "project management", "task manager", "workspace", "team", "kanban", "startup app"],
    tables: ["users", "teams", "projects", "tasks", "comments", "subscriptions"],
    core: ["users", "teams", "projects", "tasks", "subscriptions"],
  },
  {
    key: "generic",
    label: "Custom application",
    keywords: [],
    tables: ["users", "categories", "products", "orders", "payments"],
    core: ["users", "categories", "products", "orders", "payments"],
  },
];

/** Words that look like entities but should never become tables. */
export const STOP_WORDS = new Set([
  "database",
  "db",
  "system",
  "app",
  "application",
  "table",
  "tables",
  "column",
  "columns",
  "field",
  "fields",
  "record",
  "records",
  "data",
  "need",
  "want",
  "build",
  "create",
  "make",
  "manage",
  "management",
  "track",
  "tracking",
  "please",
  "thing",
  "things",
  "stuff",
  "info",
  "information",
  "detail",
  "details",
  "link",
  "links",
  "relation",
  "relations",
  "relationship",
  "relationships",
  "sql",
  "mysql",
  "postgres",
  "postgresql",
  "sqlite",
  "supabase",
  "schema",
  "project",
  "id",
  "ids",
  "key",
  "keys",
  "name",
  "names",
  "type",
  "types",
  "list",
  "site",
  "website",
  "platform",
  "software",
  "portal",
  "dashboard",
  "mobile",
  "web",
]);
