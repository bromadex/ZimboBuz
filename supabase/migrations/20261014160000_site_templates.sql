-- Website templates for every industry (P9, master plan §12.7).
--
--   * site_settings.template accepts nine templates: classic, bold, showcase,
--     menu, boutique, ministry, cause, academy and consult (one suits each
--     industry, see public.industries.website_template);
--   * new page blocks: price_list (menus, services and fees), events (service
--     times, term dates, upcoming events), team, faq, stats (impact numbers)
--     and donate (ways to give);
--   * ensure_site starts a new site with the template and starter pages that
--     suit the company's industry (a church gets service times and a giving
--     page, a school admissions and fees, and so on).

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

alter table public.site_settings drop constraint site_settings_template_check;
alter table public.site_settings add constraint site_settings_template_check
  check (template in ('classic','bold','showcase','menu','boutique','ministry','cause','academy','consult'));

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------

-- Page blocks: an array of at most 40 objects, each with an id and a known type.
-- The application checks each block's fields; this keeps the shape honest.
create or replace function app.valid_site_blocks(p_blocks jsonb)
returns boolean
language sql immutable
as $$
  select p_blocks is null or (
    jsonb_typeof(p_blocks) = 'array'
    and jsonb_array_length(p_blocks) <= 40
    and octet_length(p_blocks::text) <= 200000
    and not exists (
      select 1 from jsonb_array_elements(p_blocks) e
      where jsonb_typeof(e) <> 'object'
         or coalesce(e->>'type', '') not in ('hero','text','featured_products','products','image_text',
                                             'contact','cta','testimonials','gallery',
                                             'price_list','events','team','faq','stats','donate')
         or coalesce(length(e->>'id'), 0) not between 1 and 40));
$$;

-- ---------------------------------------------------------------------------
-- Starter pages per industry
-- ---------------------------------------------------------------------------

-- The pages a new site starts with, as a JSON array of
-- {slug, title, nav_order, blocks}. "{company}" in the text is replaced by the
-- company name. Industries without their own pages (shops, hardware,
-- wholesale, pharmacies, farming, garages, online shops and others) get the
-- shop-focused home page and a contact page.
create function app.site_starter_pages(p_industry text, p_company_name text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_pages   text;
  v_name    text := coalesce(nullif(trim(p_company_name), ''), 'us');
  v_escaped text;
  v_contact text := $j$
    {"slug": "contact", "title": "Contact us", "nav_order": 90, "blocks": [
      {"id": "contact", "type": "contact", "reveal": "fade-up", "heading": "Get in touch",
       "text": "Send us a message and we will reply as soon as we can.", "show_form": true, "show_details": true}
    ]}$j$;
begin
  v_pages := case
    when p_industry = 'church' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "{company}", "heading": "Welcome home",
         "text": "Whoever you are and wherever you are on your journey of faith, there is a place for you here. Come as you are.",
         "button_label": "Plan your visit", "button_link": "/contact", "secondary_label": "Give online", "secondary_link": "/give"},
        {"id": "service-times", "type": "events", "reveal": "fade-up", "heading": "Service times",
         "text": "Everyone is welcome. Come early for tea and a warm welcome at the door.",
         "items": [
           {"title": "Sunday service", "when": "Sundays, 9:00 to 11:30", "place": "Main sanctuary", "description": "Worship, prayer and teaching from the Word, with Sunday school for children."},
           {"title": "Midweek prayer and Bible study", "when": "Wednesdays, 17:30 to 19:00", "place": "Church hall", "description": "A smaller gathering to pray together and study the Bible."},
           {"title": "Youth fellowship", "when": "Fridays, 17:00 to 19:00", "place": "Church hall", "description": "Games, worship and honest conversations for young people aged 13 to 25."}
         ]},
        {"id": "about", "type": "text", "reveal": "fade-up", "align": "center", "heading": "A family of faith",
         "body": "{company} is a community of people who love God and love our neighbours. We meet to worship, to pray and to learn together, and we serve our city through outreach, home cells and care for those in need.\n\nIf you are new, we would love to meet you. Say hello at the welcome desk after the service."},
        {"id": "giving", "type": "donate", "reveal": "zoom", "heading": "Giving",
         "text": "Thank you for your tithes, offerings and gifts. They support the work of the church, our outreach and those in need.",
         "ways": [
           {"title": "EcoCash", "detail": "Ask the church office or send us a WhatsApp message for our EcoCash merchant code. Use your name as the reference."},
           {"title": "Bank transfer", "detail": "Ask the church office for our bank details (USD and ZWG accounts)."},
           {"title": "In person", "detail": "Give during any service. Ask for a receipt if you would like one."}
         ],
         "button_label": "Ways to give", "button_link": "/give"}
      ]},
      {"slug": "about", "title": "About us", "nav_order": 10, "blocks": [
        {"id": "story", "type": "text", "reveal": "fade-up", "align": "left", "heading": "Our story",
         "body": "Tell visitors how {company} began, what you believe and what God has done in your congregation over the years.\n\nShare your vision for the church and the community you serve."},
        {"id": "believe", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "What we believe",
         "body": "We believe in one God, Father, Son and Holy Spirit; that the Bible is God's Word; and that Jesus Christ came to bring forgiveness and new life to all who trust in him.",
         "button_label": "Visit us on Sunday", "button_link": "/contact"},
        {"id": "faq", "type": "faq", "reveal": "fade-up", "heading": "New here?",
         "items": [
           {"question": "What should I wear?", "answer": "Come as you are. You will see everything from Sunday best to jeans."},
           {"question": "Is there something for my children?", "answer": "Yes. Sunday school runs during the main service for children aged 3 to 12."},
           {"question": "How long is the service?", "answer": "About two and a half hours, with worship, prayer and a message from the Bible."}
         ]}
      ]},
      {"slug": "give", "title": "Give", "nav_order": 20, "blocks": [
        {"id": "give", "type": "donate", "reveal": "fade-up", "heading": "Give with a cheerful heart",
         "text": "Your tithes and offerings keep the doors open, support our pastors and fund outreach in our community. Thank you for your generosity.",
         "ways": [
           {"title": "EcoCash", "detail": "Ask the church office or send us a WhatsApp message for our EcoCash merchant code. Use your name and the purpose (tithe, offering or building fund) as the reference."},
           {"title": "Bank transfer", "detail": "Ask the church office for our bank details. We have accounts in USD and ZWG."},
           {"title": "Cash or card in person", "detail": "Give during any service or at the church office during the week."}
         ],
         "button_label": "Ask about giving", "button_link": "/contact"},
        {"id": "statements", "type": "text", "reveal": "fade-up", "align": "center", "heading": "Giving statements",
         "body": "Members can ask the church office for a statement of their tithes, offerings and pledges at any time."}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    when p_industry = 'ngo' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "mission", "type": "hero", "reveal": "fade-up", "eyebrow": "{company}", "heading": "Together we can change lives",
         "text": "We work alongside communities to improve health, education and livelihoods. Every gift makes a real difference.",
         "button_label": "Donate now", "button_link": "/donate", "secondary_label": "See our work", "secondary_link": "/our-work"},
        {"id": "impact", "type": "stats", "reveal": "fade-up", "heading": "Our impact so far",
         "items": [
           {"value": "?", "label": "people reached"},
           {"value": "?", "label": "communities served"},
           {"value": "?", "label": "years of service"},
           {"value": "?", "label": "of gifts accounted for"}
         ]},
        {"id": "about", "type": "text", "reveal": "fade-up", "align": "center", "heading": "Who we are",
         "body": "{company} is a registered non-profit organisation. We listen to the communities we serve and work with local leaders, schools and clinics to bring lasting change.\n\nUpdate these numbers and words with your own story."},
        {"id": "donate-cta", "type": "cta", "reveal": "zoom", "heading": "Help us reach more families",
         "text": "A gift of any size helps. We send every donor a receipt.", "button_label": "Donate", "button_link": "/donate"}
      ]},
      {"slug": "our-work", "title": "Our work", "nav_order": 10, "blocks": [
        {"id": "intro", "type": "text", "reveal": "fade-up", "align": "left", "heading": "What we do",
         "body": "Describe your programmes, where you work and who benefits. Pictures from the field help supporters see the difference they make."},
        {"id": "programme-1", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "Clean water and sanitation",
         "body": "We drill and repair boreholes, train water point committees and teach good hygiene in schools, so that families spend less time fetching water and fall ill less often."},
        {"id": "programme-2", "type": "image_text", "reveal": "fade-up", "image_side": "left", "heading": "Keeping children in school",
         "body": "We pay school fees, provide uniforms and books, and support learners who would otherwise drop out.",
         "button_label": "Support a learner", "button_link": "/donate"}
      ]},
      {"slug": "donate", "title": "Donate", "nav_order": 20, "blocks": [
        {"id": "donate", "type": "donate", "reveal": "fade-up", "heading": "Make a donation",
         "text": "Your gift goes straight to our programmes. Thank you for standing with the communities we serve.",
         "ways": [
           {"title": "EcoCash", "detail": "Contact us for our EcoCash merchant code. Use your name as the reference so we can thank you."},
           {"title": "Bank transfer", "detail": "Contact us for our bank details (USD and ZWG accounts)."},
           {"title": "Partnerships and grants", "detail": "Companies, churches and foundations: talk to us about funding a programme."}
         ],
         "button_label": "Talk to us", "button_link": "/contact"},
        {"id": "faq", "type": "faq", "reveal": "fade-up", "heading": "Questions donors ask",
         "items": [
           {"question": "Will I get a receipt?", "answer": "Yes. We send a receipt for every donation, and a yearly statement on request."},
           {"question": "Can I give to a particular programme?", "answer": "Yes. Tell us which programme in the reference or in a message and we will use your gift for it."},
           {"question": "How do you account for donations?", "answer": "Our accounts are audited every year and we report to our board and partners."}
         ]}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    when p_industry = 'school' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "{company}", "heading": "Learning today, leading tomorrow",
         "text": "A caring school where every learner is known, stretched and supported to do their best, in the classroom and beyond.",
         "button_label": "Admissions", "button_link": "/admissions", "secondary_label": "School fees", "secondary_link": "/fees"},
        {"id": "numbers", "type": "stats", "reveal": "fade-up", "heading": "",
         "items": [
           {"value": "?", "label": "teacher to learner ratio"},
           {"value": "?", "label": "pass rate"},
           {"value": "?", "label": "sports and clubs"}
         ]},
        {"id": "about", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "About our school",
         "body": "{company} offers a broad education following the Zimbabwe curriculum, with strong results, sport, music and clubs. Our teachers know every learner by name and work closely with parents.",
         "button_label": "Book a visit", "button_link": "/contact"},
        {"id": "term-dates", "type": "events", "reveal": "fade-up", "heading": "Term dates",
         "text": "Please check with the school office for exact opening and closing days.",
         "items": [
           {"title": "First term", "when": "January to April", "place": "", "description": ""},
           {"title": "Second term", "when": "May to August", "place": "", "description": ""},
           {"title": "Third term", "when": "September to December", "place": "", "description": ""}
         ]},
        {"id": "apply", "type": "cta", "reveal": "zoom", "heading": "Places for next term",
         "text": "Applications are open. Find out how to apply.", "button_label": "How to apply", "button_link": "/admissions"}
      ]},
      {"slug": "admissions", "title": "Admissions", "nav_order": 10, "blocks": [
        {"id": "how", "type": "text", "reveal": "fade-up", "align": "left", "heading": "How to apply",
         "body": "1. Collect an application form from the school office or ask us to send one by WhatsApp or email.\n2. Return it with a copy of the learner's birth certificate, their latest school report and two passport photos.\n3. We will invite you and your child for an interview and, for some grades, an entrance test.\n4. Once a place is offered, pay the registration fee to secure it."},
        {"id": "faq", "type": "faq", "reveal": "fade-up", "heading": "Questions parents ask",
         "items": [
           {"question": "Which grades do you take?", "answer": "Tell parents which grades or forms you enrol and when places are usually available."},
           {"question": "Can fees be paid in instalments?", "answer": "Yes. Talk to the bursar about a payment plan before the start of term."},
           {"question": "Which currencies do you accept?", "answer": "Fees may be paid in US dollars or in ZWG at the official rate on the day of payment."},
           {"question": "Is there transport?", "answer": "Ask the school office about bus routes and costs."}
         ]},
        {"id": "visit", "type": "cta", "reveal": "zoom", "heading": "Come and see us",
         "text": "Book a tour of the school with the admissions office.", "button_label": "Contact the office", "button_link": "/contact"}
      ]},
      {"slug": "fees", "title": "Fees", "nav_order": 20, "blocks": [
        {"id": "fees", "type": "price_list", "reveal": "fade-up", "heading": "School fees",
         "text": "Fees are per term unless stated. Update these amounts to match your fee schedule.",
         "groups": [
           {"title": "Every term", "items": [
             {"name": "Tuition", "description": "Teaching, books and stationery", "price": "US$300"},
             {"name": "Development levy", "description": "Buildings and equipment", "price": "US$50"},
             {"name": "Sports and clubs", "description": "", "price": "US$20"}
           ]},
           {"title": "Once only", "items": [
             {"name": "Registration", "description": "Paid when a place is accepted", "price": "US$50"},
             {"name": "Uniform", "description": "Available from the school shop", "price": "from US$45"}
           ]}
         ]},
        {"id": "paying", "type": "text", "reveal": "fade-up", "align": "left", "heading": "How to pay",
         "body": "Pay at the bursar's office, by bank transfer or by EcoCash. Parents with access to the parent portal can see their statement and pay invoices online."}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    when p_industry = 'professional' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "{company}", "heading": "Expert advice you can rely on",
         "text": "We help businesses and organisations across Zimbabwe make sound decisions, stay compliant and grow.",
         "button_label": "Book a consultation", "button_link": "/contact", "secondary_label": "Our services", "secondary_link": "/services"},
        {"id": "numbers", "type": "stats", "reveal": "fade-up", "heading": "",
         "items": [
           {"value": "?", "label": "years of experience"},
           {"value": "?", "label": "clients served"},
           {"value": "?", "label": "reply to every enquiry"}
         ]},
        {"id": "approach", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "How we work",
         "body": "We start by listening. Then we agree a clear scope and fee in writing, keep you informed at every step and deliver on time.",
         "button_label": "Meet the team", "button_link": "/team"},
        {"id": "talk", "type": "cta", "reveal": "zoom", "heading": "Let us talk about your needs",
         "text": "The first conversation is free.", "button_label": "Contact us", "button_link": "/contact"}
      ]},
      {"slug": "services", "title": "Services", "nav_order": 10, "blocks": [
        {"id": "intro", "type": "text", "reveal": "fade-up", "align": "left", "heading": "Our services",
         "body": "Describe what {company} does and who you do it for. Clear prices help clients decide."},
        {"id": "prices", "type": "price_list", "reveal": "fade-up", "heading": "Services and fees",
         "text": "Fees exclude VAT. We confirm every fee in a written quotation before work starts.",
         "groups": [
           {"title": "Advice", "items": [
             {"name": "First consultation", "description": "One hour to understand your needs", "price": "Free"},
             {"name": "Consulting", "description": "Per hour", "price": "US$50"}
           ]},
           {"title": "Ongoing support", "items": [
             {"name": "Monthly retainer", "description": "Regular advice and priority support", "price": "from US$500 a month"}
           ]}
         ]},
        {"id": "faq", "type": "faq", "reveal": "fade-up", "heading": "Common questions",
         "items": [
           {"question": "How do you charge?", "answer": "By the hour, by fixed fee for a defined piece of work, or by monthly retainer. We always agree the fee first."},
           {"question": "Can I pay in ZWG?", "answer": "Yes, at the official rate on the day of payment."}
         ]}
      ]},
      {"slug": "team", "title": "Our team", "nav_order": 20, "blocks": [
        {"id": "intro", "type": "text", "reveal": "fade-up", "align": "left", "heading": "The people behind {company}",
         "body": "Introduce your partners and staff, their qualifications and what they are good at."},
        {"id": "team", "type": "team", "reveal": "fade-up", "heading": "Our team", "text": "", "people": []}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    when p_industry = 'mining_construction' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "{company}", "heading": "Built right. Delivered safely.",
         "text": "Construction, civil works and mining services across Zimbabwe, on time and to specification.",
         "button_label": "Request a quote", "button_link": "/contact", "secondary_label": "Our services", "secondary_link": "/services"},
        {"id": "numbers", "type": "stats", "reveal": "fade-up", "heading": "",
         "items": [
           {"value": "?", "label": "projects completed"},
           {"value": "?", "label": "lost-time injuries this year"},
           {"value": "?", "label": "years in business"}
         ]},
        {"id": "about", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "Why clients choose us",
         "body": "Experienced engineers, our own plant and equipment, and a firm commitment to safety and quality on every site."},
        {"id": "quote", "type": "cta", "reveal": "zoom", "heading": "Planning a project?",
         "text": "Send us the details and we will prepare a quotation.", "button_label": "Request a quote", "button_link": "/contact"}
      ]},
      {"slug": "services", "title": "Services", "nav_order": 10, "blocks": [
        {"id": "civil", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "Building and civil works",
         "body": "Commercial and residential buildings, roads, drainage and site preparation."},
        {"id": "mining", "type": "image_text", "reveal": "fade-up", "image_side": "left", "heading": "Mining services",
         "body": "Drilling, haulage, plant hire and site support for small and large-scale mines."},
        {"id": "gallery", "type": "gallery", "reveal": "fade-up", "heading": "Recent projects", "images": []}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    when p_industry = 'restaurant' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "Welcome to {company}", "heading": "Good food, made fresh every day",
         "text": "Hearty local favourites and quick bites, cooked to order. Eat in, take away or order on WhatsApp.",
         "button_label": "See the menu", "button_link": "#menu", "secondary_label": "Find us", "secondary_link": "/contact"},
        {"id": "menu", "type": "price_list", "reveal": "fade-up", "heading": "Our menu",
         "text": "Prices in US dollars. We also accept ZWG, EcoCash and card.",
         "groups": [
           {"title": "Mains", "items": [
             {"name": "Sadza and beef stew", "description": "With greens of the day", "price": "US$5.00"},
             {"name": "Sadza and road runner chicken", "description": "Slow-cooked free-range chicken", "price": "US$6.00"},
             {"name": "Rice and grilled chicken", "description": "Quarter chicken with coleslaw", "price": "US$5.50"},
             {"name": "T-bone steak and chips", "description": "", "price": "US$9.00"}
           ]},
           {"title": "Quick bites", "items": [
             {"name": "Chips (large)", "description": "", "price": "US$2.50"},
             {"name": "Boerewors roll", "description": "", "price": "US$3.00"},
             {"name": "Beef burger and chips", "description": "", "price": "US$5.00"}
           ]},
           {"title": "Drinks", "items": [
             {"name": "Soft drink (500 ml)", "description": "", "price": "US$1.00"},
             {"name": "Mazoe orange (glass)", "description": "", "price": "US$0.80"},
             {"name": "Tea or coffee", "description": "", "price": "US$1.00"}
           ]}
         ]},
        {"id": "about", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "About us",
         "body": "{company} serves honest, home-style food made with fresh local ingredients. Come hungry and leave happy."},
        {"id": "order", "type": "cta", "reveal": "zoom", "heading": "Feeding a crowd?",
         "text": "We cater for parties, funerals, weddings and office lunches.", "button_label": "Ask about catering", "button_link": "/contact"}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    when p_industry = 'hospitality' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "{company}", "heading": "Rest well, feel at home",
         "text": "Comfortable rooms, warm hospitality and good food. Perfect for business travel, family stays and weekends away.",
         "button_label": "Book a room", "button_link": "/contact", "secondary_label": "Rooms and rates", "secondary_link": "#rates"},
        {"id": "rates", "type": "price_list", "reveal": "fade-up", "heading": "Rooms and rates",
         "text": "Rates per room per night, in US dollars. Ask about rates for groups and conferences.",
         "groups": [
           {"title": "Rooms", "items": [
             {"name": "Standard room", "description": "Double bed, en-suite, Wi-Fi and DStv", "price": "US$60"},
             {"name": "Executive room", "description": "King-size bed, desk and lounge area", "price": "US$85"},
             {"name": "Family room", "description": "Sleeps four", "price": "US$110"}
           ]},
           {"title": "Extras", "items": [
             {"name": "Full breakfast", "description": "Per person", "price": "US$8"},
             {"name": "Conference room", "description": "Per day, with tea and lunch", "price": "from US$15 a person"}
           ]}
         ]},
        {"id": "about", "type": "image_text", "reveal": "fade-up", "image_side": "right", "heading": "Stay with us",
         "body": "{company} offers secure parking, a backup power supply and borehole water, a restaurant and friendly staff on hand day and night."},
        {"id": "gallery", "type": "gallery", "reveal": "fade-up", "heading": "Take a look around", "images": []},
        {"id": "book", "type": "cta", "reveal": "zoom", "heading": "Ready to book?",
         "text": "Send us your dates and we will confirm your room.", "button_label": "Make a booking", "button_link": "/contact"}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    when p_industry = 'salon' then $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "{company}", "heading": "Look good, feel great",
         "text": "Cuts, braids, colour, nails and more, by stylists who take their time and get it right.",
         "button_label": "Book an appointment", "button_link": "/contact", "secondary_label": "See prices", "secondary_link": "#prices"},
        {"id": "prices", "type": "price_list", "reveal": "fade-up", "heading": "Price list",
         "text": "Prices in US dollars and may vary with hair length and products used.",
         "groups": [
           {"title": "Hair", "items": [
             {"name": "Haircut", "description": "Wash, cut and style", "price": "US$3"},
             {"name": "Braids", "description": "Hair not included", "price": "from US$25"},
             {"name": "Relaxer and treatment", "description": "", "price": "US$15"},
             {"name": "Wig installation", "description": "", "price": "US$20"}
           ]},
           {"title": "Nails and beauty", "items": [
             {"name": "Manicure", "description": "", "price": "US$8"},
             {"name": "Pedicure", "description": "", "price": "US$10"},
             {"name": "Gel polish", "description": "Hands or feet", "price": "US$12"}
           ]}
         ]},
        {"id": "team", "type": "team", "reveal": "fade-up", "heading": "Meet our stylists", "text": "", "people": []},
        {"id": "book", "type": "cta", "reveal": "zoom", "heading": "Book your appointment",
         "text": "Send us a WhatsApp message or call to choose a time.", "button_label": "Contact us", "button_link": "/contact"}
      ]},
      $j$ || v_contact || $j$
    ]$j$

    else $j$[
      {"slug": "home", "title": "Home", "nav_order": 0, "blocks": [
        {"id": "welcome", "type": "hero", "reveal": "fade-up", "eyebrow": "Welcome", "heading": "{company}",
         "text": "Quality products, fair prices and friendly service. Browse what we have in stock or ask us for a quote.",
         "button_label": "Browse the shop", "button_link": "/shop", "secondary_label": "Contact us", "secondary_link": "/contact"},
        {"id": "popular", "type": "featured_products", "reveal": "fade-up", "heading": "Popular products",
         "text": "A few of the things our customers buy most.", "count": 8},
        {"id": "about", "type": "text", "reveal": "fade-up", "heading": "About us",
         "body": "Welcome to {company}. We are proud to serve our customers with quality products, honest prices and friendly service."},
        {"id": "quote", "type": "cta", "reveal": "zoom", "heading": "Need a price for a bigger order?",
         "text": "Add products to your quote and we will get back to you quickly.", "button_label": "Contact us", "button_link": "/contact"}
      ]},
      $j$ || v_contact || $j$
    ]$j$
  end;

  -- The company name, escaped for use inside a JSON string.
  v_escaped := to_jsonb(v_name)::text;
  v_escaped := substr(v_escaped, 2, length(v_escaped) - 2);
  return replace(v_pages, '{company}', v_escaped)::jsonb;
end;
$$;

revoke execute on function app.site_starter_pages(text, text) from public;

-- ---------------------------------------------------------------------------
-- Setting up a site
-- ---------------------------------------------------------------------------

-- Creates the company's site settings and starter pages (already published)
-- the first time the website is opened. A new site uses the template and
-- pages that suit the company's industry. Safe to call repeatedly.
create or replace function public.ensure_site(p_company uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_name     text;
  v_industry text;
  v_template text;
  v_page     jsonb;
begin
  if not app.can(p_company, 'website.edit') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.site_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  if exists (select 1 from public.site_pages where company_id = p_company) then
    return;
  end if;

  select c.name, c.industry_code, i.website_template
  into v_name, v_industry, v_template
  from public.companies c left join public.industries i on i.code = c.industry_code
  where c.id = p_company;

  update public.site_settings
  set template = case when v_template in ('classic','bold','showcase','menu','boutique','ministry','cause','academy','consult')
                      then v_template else 'classic' end
  where company_id = p_company;

  for v_page in select * from jsonb_array_elements(app.site_starter_pages(v_industry, v_name)) loop
    insert into public.site_pages (company_id, slug, title, nav_order, show_in_menu, blocks,
                                   published_title, published_blocks, published_at, published_by)
    values (p_company, v_page->>'slug', v_page->>'title', (v_page->>'nav_order')::integer, true, v_page->'blocks',
            v_page->>'title',
            -- Impact numbers start as "?" for the company to fill in, so they
            -- stay in the draft and are not published until edited.
            coalesce((select jsonb_agg(b order by n) from jsonb_array_elements(v_page->'blocks') with ordinality as e(b, n)
                      where b->>'type' <> 'stats'), '[]'::jsonb),
            now(), auth.uid());
  end loop;
end;
$$;

revoke execute on function public.ensure_site(uuid) from public, anon;
grant execute on function public.ensure_site(uuid) to authenticated;
