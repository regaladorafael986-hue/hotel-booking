-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `first_name` VARCHAR(80) NOT NULL,
    `last_name` VARCHAR(80) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('CUSTOMER', 'RECEPTIONIST', 'ADMIN') NOT NULL DEFAULT 'CUSTOMER',
    `account_status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `permissions` JSON NULL,
    `email_verified_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_role_idx`(`role`),
    INDEX `users_account_status_idx`(`account_status`),
    INDEX `users_last_name_first_name_idx`(`last_name`, `first_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET') NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_tokens_user_id_type_idx`(`user_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `sid` VARCHAR(128) NOT NULL,
    `data` TEXT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`sid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hotel_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotel_name` VARCHAR(120) NOT NULL,
    `tagline` VARCHAR(200) NULL,
    `description` TEXT NULL,
    `address` VARCHAR(255) NULL,
    `contact_number` VARCHAR(40) NULL,
    `email` VARCHAR(191) NULL,
    `check_in_time` VARCHAR(5) NOT NULL DEFAULT '14:00',
    `check_out_time` VARCHAR(5) NOT NULL DEFAULT '12:00',
    `cancellation_policy` TEXT NULL,
    `hotel_policies` TEXT NULL,
    `free_cancellation_hours` INTEGER NOT NULL DEFAULT 48,
    `tax_rate` DECIMAL(5, 2) NOT NULL DEFAULT 12.00,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'PHP',
    `pay_at_hotel_auto_confirm` BOOLEAN NOT NULL DEFAULT true,
    `hold_minutes` INTEGER NOT NULL DEFAULT 15,
    `map_embed_url` VARCHAR(500) NULL,
    `facebook_url` VARCHAR(255) NULL,
    `instagram_url` VARCHAR(255) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hotel_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `image_url` VARCHAR(500) NOT NULL,
    `public_id` VARCHAR(255) NULL,
    `caption` VARCHAR(150) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `short_description` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `base_price` DECIMAL(12, 2) NOT NULL,
    `max_adults` INTEGER NOT NULL,
    `max_children` INTEGER NOT NULL DEFAULT 0,
    `bed_type` VARCHAR(60) NOT NULL,
    `size_sqm` INTEGER NULL,
    `is_featured` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `room_types_name_key`(`name`),
    UNIQUE INDEX `room_types_slug_key`(`slug`),
    INDEX `room_types_status_idx`(`status`),
    INDEX `room_types_base_price_idx`(`base_price`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rooms` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `room_type_id` INTEGER NOT NULL,
    `room_number` VARCHAR(20) NOT NULL,
    `floor` INTEGER NOT NULL,
    `housekeeping_status` ENUM('CLEAN', 'DIRTY', 'CLEANING', 'MAINTENANCE') NOT NULL DEFAULT 'CLEAN',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `notes` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rooms_room_number_key`(`room_number`),
    INDEX `rooms_room_type_id_is_active_idx`(`room_type_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `room_type_id` INTEGER NOT NULL,
    `image_url` VARCHAR(500) NOT NULL,
    `public_id` VARCHAR(255) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `room_images_room_type_id_idx`(`room_type_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `amenities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(80) NOT NULL,
    `icon` VARCHAR(40) NULL,
    `description` VARCHAR(255) NULL,

    UNIQUE INDEX `amenities_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `room_type_amenities` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `room_type_id` INTEGER NOT NULL,
    `amenity_id` INTEGER NOT NULL,

    INDEX `room_type_amenities_amenity_id_idx`(`amenity_id`),
    UNIQUE INDEX `room_type_amenities_room_type_id_amenity_id_key`(`room_type_id`, `amenity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bookings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_reference` VARCHAR(20) NOT NULL,
    `user_id` INTEGER NULL,
    `created_by_id` INTEGER NULL,
    `source` ENUM('ONLINE', 'WALK_IN') NOT NULL DEFAULT 'ONLINE',
    `guest_first_name` VARCHAR(80) NOT NULL,
    `guest_last_name` VARCHAR(80) NOT NULL,
    `guest_email` VARCHAR(191) NOT NULL,
    `guest_phone` VARCHAR(30) NULL,
    `special_requests` TEXT NULL,
    `check_in` DATE NOT NULL,
    `check_out` DATE NOT NULL,
    `nights` INTEGER NOT NULL,
    `adults` INTEGER NOT NULL,
    `children` INTEGER NOT NULL DEFAULT 0,
    `total_rooms` INTEGER NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxes` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `amount_paid` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amount_refunded` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `coupon_id` INTEGER NULL,
    `coupon_code` VARCHAR(40) NULL,
    `booking_status` ENUM('PENDING_PAYMENT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED') NOT NULL,
    `payment_status` ENUM('PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `payment_method` ENUM('ONLINE', 'PAY_AT_HOTEL') NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `checked_in_at` DATETIME(3) NULL,
    `checked_out_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancellation_status` ENUM('NONE', 'REQUESTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NONE',
    `cancellation_reason` TEXT NULL,
    `cancellation_requested_at` DATETIME(3) NULL,
    `cancellation_note` TEXT NULL,
    `reminder_sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bookings_booking_reference_key`(`booking_reference`),
    INDEX `bookings_user_id_idx`(`user_id`),
    INDEX `bookings_check_in_check_out_idx`(`check_in`, `check_out`),
    INDEX `bookings_booking_status_idx`(`booking_status`),
    INDEX `bookings_payment_status_idx`(`payment_status`),
    INDEX `bookings_expires_at_idx`(`expires_at`),
    INDEX `bookings_guest_last_name_guest_first_name_idx`(`guest_last_name`, `guest_first_name`),
    INDEX `bookings_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_rooms` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_id` INTEGER NOT NULL,
    `room_id` INTEGER NOT NULL,
    `room_type_id` INTEGER NOT NULL,
    `nightly_rate` DECIMAL(12, 2) NOT NULL,
    `adults` INTEGER NOT NULL,
    `children` INTEGER NOT NULL DEFAULT 0,

    INDEX `booking_rooms_booking_id_idx`(`booking_id`),
    INDEX `booking_rooms_room_id_idx`(`room_id`),
    INDEX `booking_rooms_room_type_id_idx`(`room_type_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_id` INTEGER NOT NULL,
    `payment_reference` VARCHAR(40) NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `provider_session_id` VARCHAR(120) NULL,
    `provider_payment_id` VARCHAR(120) NULL,
    `checkout_url` VARCHAR(500) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `amount_refunded` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `payment_method` VARCHAR(30) NULL,
    `payment_status` ENUM('PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `failure_reason` VARCHAR(255) NULL,
    `recorded_by_id` INTEGER NULL,
    `notes` VARCHAR(255) NULL,
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_payment_reference_key`(`payment_reference`),
    UNIQUE INDEX `payments_provider_session_id_key`(`provider_session_id`),
    INDEX `payments_booking_id_idx`(`booking_id`),
    INDEX `payments_payment_status_idx`(`payment_status`),
    INDEX `payments_paid_at_idx`(`paid_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(120) NOT NULL,
    `event_type` VARCHAR(80) NOT NULL,
    `payload` MEDIUMTEXT NOT NULL,
    `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_events_provider_event_id_key`(`provider`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payment_id` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `refund_status` ENUM('PENDING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `provider_reference` VARCHAR(120) NULL,
    `processed_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `refunds_payment_id_idx`(`payment_id`),
    INDEX `refunds_refund_status_idx`(`refund_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `booking_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `rating` TINYINT NOT NULL,
    `title` VARCHAR(120) NULL,
    `comment` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reviews_booking_id_key`(`booking_id`),
    INDEX `reviews_user_id_idx`(`user_id`),
    INDEX `reviews_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `description` VARCHAR(255) NULL,
    `discount_type` ENUM('PERCENTAGE', 'FIXED') NOT NULL,
    `discount_value` DECIMAL(12, 2) NOT NULL,
    `minimum_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `maximum_discount` DECIMAL(12, 2) NULL,
    `usage_limit` INTEGER NULL,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `is_featured` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupons_code_key`(`code`),
    INDEX `coupons_status_start_date_end_date_idx`(`status`, `start_date`, `end_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `booking_id` INTEGER NULL,
    `title` VARCHAR(150) NOT NULL,
    `message` TEXT NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_is_read_idx`(`user_id`, `is_read`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity_type` VARCHAR(40) NULL,
    `entity_id` VARCHAR(40) NULL,
    `description` TEXT NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_user_id_idx`(`user_id`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_images` ADD CONSTRAINT `room_images_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_type_amenities` ADD CONSTRAINT `room_type_amenities_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_type_amenities` ADD CONSTRAINT `room_type_amenities_amenity_id_fkey` FOREIGN KEY (`amenity_id`) REFERENCES `amenities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_rooms` ADD CONSTRAINT `booking_rooms_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_rooms` ADD CONSTRAINT `booking_rooms_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_rooms` ADD CONSTRAINT `booking_rooms_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_recorded_by_id_fkey` FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
