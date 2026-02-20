// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract JubJubPublishLedger {
    // JubJub permission roles today
    // 0 = Viewer, 1 = Editor, 2 = Publisher, 3 = Admin
    enum Role {
        Viewer,
        Editor,
        Publisher,
        Admin
    }

    // Emitted once per publish action.
    // - mediaHash: fingerprint of the media (hash of file bytes, or hash of a canonical export)
    // - platform: keccak256("instagram") / keccak256("tiktok") / keccak256("youtube") / keccak256("farcaster") etc.
    // - destination: keccak256("@handle") or keccak256("channelId") etc.
    // - publishId: keccak256(JubJub internal publish job id) to reconcile later without exposing it
    // - contributors: list of JubJub user ids hashed (keccak256("jubjub_user_123"))
    // - roles: matching roles array (same length as contributors)
    event PublishRecorded(
        bytes32 indexed mediaHash,
        address indexed publisher,
        bytes32 indexed platform,
        bytes32 destination,
        bytes32 publishId,
        bytes32[] contributors,
        uint8[] roles,
        uint256 timestamp
    );

    event LaunchRecorded(
        bytes32 indexed workspaceId,
        bytes32 indexed launchId,
        address indexed recorder,
        bytes32 ownerProfile,
        bytes32[] platforms,
        bytes32[] contributors,
        uint8[] roles,
        uint256 timestamp
    );

    error ContributorsRolesLengthMismatch();
    error EmptyContributors();
    error EmptyPlatforms();

    function recordPublish(
        bytes32 mediaHash,
        bytes32 platform,
        bytes32 destination,
        bytes32 publishId,
        bytes32[] calldata contributors,
        uint8[] calldata roles
    ) external {
        if (contributors.length == 0) revert EmptyContributors();
        if (contributors.length != roles.length) revert ContributorsRolesLengthMismatch();

        emit PublishRecorded(
            mediaHash,
            msg.sender,
            platform,
            destination,
            publishId,
            contributors,
            roles,
            block.timestamp
        );
    }

    function recordLaunch(
        bytes32 workspaceId,
        bytes32 launchId,
        bytes32 ownerProfile,
        bytes32[] calldata platforms,
        bytes32[] calldata contributors,
        uint8[] calldata roles
    ) external {
        if (platforms.length == 0) revert EmptyPlatforms();
        if (contributors.length == 0) revert EmptyContributors();
        if (contributors.length != roles.length) revert ContributorsRolesLengthMismatch();

        emit LaunchRecorded(
            workspaceId,
            launchId,
            msg.sender,
            ownerProfile,
            platforms,
            contributors,
            roles,
            block.timestamp
        );
    }
}
