-- AlterTable
ALTER TABLE `users` MODIFY `password_hash` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `oauth_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `provider_user_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oauth_accounts_provider_provider_user_id_key`(`provider`, `provider_user_id`),
    UNIQUE INDEX `oauth_accounts_user_id_provider_key`(`user_id`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `oauth_accounts` ADD CONSTRAINT `oauth_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
